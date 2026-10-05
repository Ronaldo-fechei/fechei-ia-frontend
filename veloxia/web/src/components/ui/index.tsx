import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { initials } from "../../lib/format";

/* ------------------------------------------------------------------ */
/* Botões                                                              */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "dark";
type Size = "xs" | "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-600/60",
  secondary: "bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 shadow-sm",
  outline: "border border-brand-200 text-brand-700 hover:bg-brand-50",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  dark: "bg-ink-900 text-white hover:bg-ink-800 shadow-sm",
};
const sizes: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1 rounded-md",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ to, variant = "primary", size = "md", icon, className, children }: { to: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn("inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors", variants[variant], sizes[size], className)}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn("inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40", className)}
        {...rest}
      />
    </Tooltip>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-5 animate-spin text-zinc-400", className)} />;
}

/* ------------------------------------------------------------------ */
/* Formulários                                                         */
/* ------------------------------------------------------------------ */

const fieldBase =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 transition-colors focus:border-brand-400 focus:ring-3 focus:ring-brand-100 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-10", invalid && "border-red-400 focus:border-red-400 focus:ring-red-100", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", invalid && "border-red-400", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-10 cursor-pointer pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-sm font-medium text-zinc-800", className)}>
      {children}
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  optional?: boolean;
}) {
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {optional && <span className="ml-1 font-normal text-zinc-400">(opcional)</span>}
        </Label>
      )}
      {children}
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2.5 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-brand-600"
      />
      <span>
        <span className="font-medium text-zinc-800">{label}</span>
        {description && <span className="block text-xs text-zinc-500">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-zinc-300 transition-colors data-[state=checked]:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Exibição                                                            */
/* ------------------------------------------------------------------ */

export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cn("card", padded && "p-5", className)}>{children}</div>;
}

export function CardTitle({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeTones = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  yellow: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "gray", children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", badgeTones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function TagPill({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}1a`, color }}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remover tag ${name}`} className="-mr-0.5 rounded-full hover:bg-black/5">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export function Avatar({ src, name, size = 36, className }: { src?: string | null; name?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (src && !failed) {
    return <img src={src} alt="" style={style} onError={() => setFailed(true)} className={cn("shrink-0 rounded-full object-cover ring-1 ring-zinc-200", className)} />;
  }
  return (
    <span style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-amber-100 font-semibold text-brand-800", className)}>
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-zinc-200/70", className)} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>}
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const calloutTones = {
  info: { cls: "border-sky-200 bg-sky-50 text-sky-900", icon: Info },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CircleCheck },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", icon: TriangleAlert },
  error: { cls: "border-red-200 bg-red-50 text-red-900", icon: CircleAlert },
};

export function Callout({ tone = "info", title, children, action, className }: { tone?: keyof typeof calloutTones; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = calloutTones[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("leading-relaxed", title && "mt-1 opacity-90")}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("scrollbar-thin flex gap-1 overflow-x-auto border-b border-zinc-200", className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
            value === item.value ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, size = "sm" }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            value === item.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number | null | undefined; className?: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-zinc-100", className)}>
      <div className={cn("h-full rounded-full transition-all", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-500")} style={{ width: `${max ? pct : 0}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600">{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/* Sobreposições                                                       */
/* ------------------------------------------------------------------ */

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow-pop animate-fade-in">
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-pop animate-slide-up sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-zinc-900">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-zinc-500">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Janela"}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/30 animate-fade-in" />
        <Dialog.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-pop animate-slide-in", width)}>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold text-zinc-900">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-zinc-500">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Detalhes</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-xl border border-zinc-200 bg-white p-1 shadow-pop animate-fade-in">
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-zinc-100",
        danger ? "text-red-600" : "text-zinc-700",
      )}
    >
      {icon && <span className="[&>svg]:size-4">{icon}</span>}
      {children}
    </DropdownMenu.Item>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="my-1 h-px bg-zinc-100" />;

/* ------------------------------------------------------------------ */
/* Confirmação                                                         */
/* ------------------------------------------------------------------ */

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => undefined);
  const confirm = useCallback((opts: ConfirmOptions) => {
    setState({ ...opts, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (v: boolean) => {
    resolver.current(v);
    setState((s) => (s ? { ...s, open: false } : s));
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state?.open}
        onOpenChange={(o) => !o && close(false)}
        title={state?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {state?.confirmLabel ?? "Confirmar"}
            </Button>
          </>
        }
      >
        <div className="text-sm text-zinc-600">{state?.description}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
