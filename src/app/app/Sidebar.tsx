"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MyProfile = {
  id: string;
  is_admin: boolean;
  name?: string | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);

  const navItems: NavItem[] = useMemo(
    () => [
      { href: "/app", label: "資訊儀表板", icon: "📊" },
      { href: "/app/projects", label: "專案管理", icon: "📁" },
      { href: "/app/validations", label: "專案驗證數據", icon: "✅" },
      { href: "/app/plans", label: "行程規劃", icon: "📅" },
      { href: "/app/export", label: "日報PPT匯出", icon: "📄" },
      { href: "/app/issues", label: "異常狀態列表", icon: "🚨" },
      { href: "/app/admin", label: "主管專區", icon: "🛡️", adminOnly: true },
    ],
    []
  );

  function isActive(href: string) {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const user = u.user;
      if (!user) return;

      const fallback = user.email ?? "";

      const { data } = await supabase
        .from("profiles")
        .select("is_admin,name")
        .eq("id", user.id)
        .maybeSingle();

      setIsAdmin(!!data?.is_admin);
      setDisplayName((data?.name ?? fallback).toString());
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  return (
    <aside style={shell}>
      {/* LOGO / TITLE */}
      <div style={header}>
        {/* 使用者卡 */}
        <div style={userCard}>
          <div style={userLabel}>使用者</div>
          <div style={userName}>{displayName || "—"}</div>
        </div>
      </div>

      {/* MENU */}
      <div style={menuWrap}>
        <div style={menuTitle}>選單</div>

        {navItems
          .filter((x) => !x.adminOnly || (!loading && isAdmin))
          .map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...menuBtn,
                  ...(active ? menuBtnActive : {}),
                }}
              >
                <span style={icon}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
      </div>

      {/* FOOTER */}
      <div style={footer}>
        <button style={logoutBtn} onClick={logout}>
          登出
        </button>

        <div style={roleText}>
          {loading ? "讀取中..." : isAdmin ? "Admin" : "一般使用者"}
        </div>
      </div>
    </aside>
  );
}

/* ---------- STYLE ---------- */

const shell: React.CSSProperties = {
  width: 260, // ⭐ 原本太寬 → 收窄
  height: "100vh",
  background: "#fff",
  borderRight: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
};

const header: React.CSSProperties = {
  padding: "18px 16px 14px",
  borderBottom: "1px solid #f1f5f9",
};

const title: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 15,
  color: "#111827",
};

const sub: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
};

const userCard: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
};

const userLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  fontWeight: 700,
};

const userName: React.CSSProperties = {
  marginTop: 2,
  fontWeight: 900,
  fontSize: 14,
};

const menuWrap: React.CSSProperties = {
  flex: 1,
  padding: "14px 10px",
};

const menuTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  color: "#94a3b8",
  padding: "0 10px",
  marginBottom: 8,
};

const menuBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px", // ⭐ 原本太高 → 壓縮
  borderRadius: 10,
  textDecoration: "none",
  color: "#0f172a",
  fontWeight: 700,
  marginBottom: 4,
};

const menuBtnActive: React.CSSProperties = {
  background: "#eef2ff",
  color: "#1d4ed8",
  border: "1px solid #c7d2fe",
};

const icon: React.CSSProperties = {
  width: 22,
  textAlign: "center",
};

const footer: React.CSSProperties = {
  padding: 14,
  borderTop: "1px solid #f1f5f9",
};

const logoutBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const roleText: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "#94a3b8",
};
