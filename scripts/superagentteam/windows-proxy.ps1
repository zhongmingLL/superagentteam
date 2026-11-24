# SuperAgentTeam Windows -> WSL TCP proxy.
# Run with -ListenPort 3103 -BridgePath <wsl bridge path> to start a proxy;
# add -Check to inspect the current listener without starting a new one.
param(
    [int]$ListenPort = 3103,
    [string]$BridgePath = "/tmp/f025-tcp-bridge-3005.py",
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$code = @'
using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

public class WslPortProxy
{
    public static void Run(int listenPort, string bridgePath)
    {
        var listener = new TcpListener(IPAddress.Loopback, listenPort);
        listener.Start();
        Console.WriteLine("listening 127.0.0.1:" + listenPort + " -> wsl " + bridgePath);
        while (true)
        {
            var client = listener.AcceptTcpClient();
            var worker = new System.Threading.Thread(() => Handle(client, bridgePath));
            worker.IsBackground = true;
            worker.Start();
        }
    }

    private static void Handle(TcpClient client, string bridgePath)
    {
        try
        {
            using (client)
            {
                var psi = new ProcessStartInfo("wsl.exe", "--exec /usr/bin/python3 " + bridgePath)
                {
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var proc = Process.Start(psi))
                {
                    proc.ErrorDataReceived += (s, e) => { };
                    proc.BeginErrorReadLine();
                    var stream = client.GetStream();
                    var up = new System.Threading.Thread(() => Pump(
                        stream, proc.StandardInput.BaseStream,
                        () => { try { proc.StandardInput.Close(); } catch { } }));
                    var down = new System.Threading.Thread(() => Pump(
                        proc.StandardOutput.BaseStream, stream,
                        () => { try { client.Close(); } catch { } }));
                    up.IsBackground = true;
                    down.IsBackground = true;
                    up.Start();
                    down.Start();
                    up.Join();
                    down.Join();
                }
            }
        }
        catch
        {
            try { client.Close(); } catch { }
        }
    }

    private static void Pump(System.IO.Stream from, System.IO.Stream to, System.Action onEnd)
    {
        var buffer = new byte[8192];
        try
        {
            while (true)
            {
                var read = from.Read(buffer, 0, buffer.Length);
                if (read <= 0) break;
                to.Write(buffer, 0, read);
                to.Flush();
            }
        }
        catch
        {
        }
        try { onEnd(); } catch { }
    }
}
'@

if ($Check) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        Write-Error "no listener on 127.0.0.1:$ListenPort"
        exit 1
    }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Output "listening $ListenPort pid=$($listener.OwningProcess) name=$($proc.Name)"
    Write-Output "command=$($proc.CommandLine)"
    exit 0
}

Add-Type -TypeDefinition $code -Language CSharp
[WslPortProxy]::Run($ListenPort, $BridgePath)
