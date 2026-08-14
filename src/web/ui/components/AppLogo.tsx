import { cn } from "../lib/cn";

interface AppLogoProps {
  readonly size?: "sm" | "md" | "lg" | "hero";
  readonly className?: string;
}

export function AppLogo({ size = "md", className }: AppLogoProps) {
  return (
    <span
      className={cn("app-logo", `app-logo--${size}`, className)}
      data-no-localize="true"
      aria-label="AgentHub"
      role="img"
    >
      <img src="/logo.png" alt="" className="app-logo__image" aria-hidden="true" />
    </span>
  );
}
