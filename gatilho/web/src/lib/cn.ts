import clsx, { type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Sombras personalizadas do tema também entram na resolução de conflitos.
const twMerge = extendTailwindMerge({ extend: { classGroups: { shadow: [{ shadow: ["card", "pop"] }] } } });

/** Junta classes e resolve conflitos do Tailwind (a última classe vence). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
