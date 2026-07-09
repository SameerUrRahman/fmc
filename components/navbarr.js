"use client";
import { Navbar, NavbarBrand, NavbarContent, NavbarItem } from "@heroui/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbarr() {
  const pathname = usePathname();
  return (
    <Navbar isBordered maxWidth="full" classNames={{ wrapper: "px-2" }}>
      <NavbarBrand>
        <Link className="text-primary font-bold text-lg" href="/">
          FMC
        </Link>
      </NavbarBrand>
      <NavbarContent justify="end">
        <NavbarItem isActive={pathname === "/"}>
          <Link href="/" className={pathname === "/" ? "text-primary" : ""}>
            Recipes
          </Link>
        </NavbarItem>
        <NavbarItem isActive={pathname === "/prices"}>
          <Link href="/prices" className={pathname === "/prices" ? "text-primary" : ""}>
            Price Book
          </Link>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
