"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Colección", icon: "▦" },
  { href: "/escanear", label: "Escanear", icon: "◎" },
  { href: "/buscar", label: "Buscar", icon: "⌕" },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? "nav-item active" : "nav-item"}>
            <span className="nav-icon" aria-hidden>{i.icon}</span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
