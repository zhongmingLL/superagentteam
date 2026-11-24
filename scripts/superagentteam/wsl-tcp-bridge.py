#!/usr/bin/env python3
"""Raw TCP bridge: WSL stdio <-> a WSL loopback port.

Usage: python3 wsl-tcp-bridge.py [targetPort]
The Windows proxy starts this via WSL exec with Python.
"""
import os
import socket
import sys
import threading

target_port = int(sys.argv[1]) if len(sys.argv) > 1 else 3005
sock = socket.create_connection(("127.0.0.1", target_port))


def pump_in() -> None:
    while True:
        data = os.read(0, 65536)
        if not data:
            break
        sock.sendall(data)
    try:
        sock.shutdown(socket.SHUT_WR)
    except OSError:
        pass


threading.Thread(target=pump_in, daemon=True).start()
try:
    while True:
        data = sock.recv(65536)
        if not data:
            break
        os.write(1, data)
finally:
    sock.close()
