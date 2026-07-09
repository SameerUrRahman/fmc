"use client";
import { Navbar, NavbarBrand, NavbarContent, NavbarItem } from "@heroui/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, children, active }) {
  return (
    <Link
      href={href}
      className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
        active
          ? "bg-primary/15 text-primary font-medium"
          : "text-default-500 hover:text-foreground hover:bg-content2"
      }`}
    >
      {children}
    </Link>
  );
}

export default function Navbarr() {
  const pathname = usePathname();
  return (
    <Navbar isBordered maxWidth="xl" classNames={{ base: "bg-background/80" }}>
      <NavbarBrand className="gap-2">
        <span className="text-xl">🧾</span>
        <Link className="font-bold text-lg text-foreground" href="/">
          FMC
          <span className="hidden sm:inline text-default-400 font-normal text-sm ml-2">
            recipe costs
          </span>
        </Link>
      </NavbarBrand>
      <NavbarContent justify="end" className="gap-1">
        <NavbarItem>
          <NavLink href="/" active={pathname === "/" || pathname.startsWith("/recipe")}>
            Recipes
          </NavLink>
        </NavbarItem>
        <NavbarItem>
          <NavLink href="/prices" active={pathname === "/prices"}>
            Price Book
          </NavLink>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
