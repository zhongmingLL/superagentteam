import { Link, useLocation } from "react-router-dom";

import { Icon, type IconName } from "@/components/ui/Icon";
import type { Theme } from "@/lib/theme";

export interface NavRailProps {
	theme: Theme;
	onToggleTheme: () => void;
}

function RailButton({
	icon,
	label,
	active = false,
	disabled = false,
	title,
	onClick,
}: {
	icon: IconName;
	label: string;
	active?: boolean;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			className={`st-nav-item${active ? " is-active" : ""}`}
			onClick={onClick}
			disabled={disabled}
			title={title}
			aria-current={active ? "page" : undefined}
		>
			<Icon name={icon} size={18} />
			<span className="st-nav-item-label">{label}</span>
		</button>
	);
}

export function NavRail({ theme, onToggleTheme }: NavRailProps) {
	const { pathname } = useLocation();
	const settingsActive = pathname.startsWith("/settings");
	const threadsActive = pathname === "/" || pathname.startsWith("/thread/");
	return (
		<nav className="st-nav-rail" aria-label="主导航">
			<Link className="st-nav-logo" to="/" aria-label="SuperAgentTeam 首页">
				<span>S</span>
			</Link>
			<span className="st-nav-divider" aria-hidden="true" />
			<Link
				className={`st-nav-item${threadsActive ? " is-active" : ""}`}
				to="/"
				aria-current={threadsActive ? "page" : undefined}
			>
				<Icon name="threads" size={18} />
				<span className="st-nav-item-label">Threads</span>
			</Link>
			<RailButton icon="tasks" label="Tasks" disabled title="Tasks 页面尚未实现" />
			<RailButton icon="memory" label="Memory" disabled title="Memory 页面尚未实现" />
			<span className="st-nav-spacer" />
			<RailButton
				icon={theme === "dark" ? "sun" : "moon"}
				label="Theme"
				onClick={onToggleTheme}
				title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
			/>
			<Link
				className={`st-nav-item${settingsActive ? " is-active" : ""}`}
				to="/settings"
				aria-current={settingsActive ? "page" : undefined}
			>
				<Icon name="settings" size={18} />
				<span className="st-nav-item-label">设置</span>
			</Link>
			<span className="st-nav-version">v1 · local</span>
		</nav>
	);
}
