import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

const baseClasses =
  "inline-flex items-center justify-center rounded-card px-5 py-2.5 font-body font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand/90",
  secondary: "bg-tint text-brand hover:bg-tint/80",
};

/**
 * Button's classes without the <button> element. Use this to style a `Link`
 * that should look like a button -- nesting <Button> inside <Link> puts a
 * <button> inside an <a>, which HTML5 disallows (interactive content can't
 * contain interactive content).
 */
export function buttonClasses(
  variant: NonNullable<ButtonProps["variant"]> = "primary",
  className = "",
) {
  return `${baseClasses} ${variantClasses[variant]} ${className}`;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, className)} {...props} />;
}
