"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import ProjectProgressList from "./ProjectProgressList";
import WeeklyGridReadOnly from "./WeeklyGridReadOnly"; // ✅ 改這個

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw new Error(error.message);

        const user = data.user;
        if (!user) {
          router.replace("/login");
          return;
        }

        if (!alive) return;
        setEmail(user.email ?? null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setMsg("❌ " + (e?.message ?? "unknown"));
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  async function signOut() {
    setMsg("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMsg(error.message);
      return;
    }
    router.replace("/login");
  }

  if (loading) {
    return (
      <div style={styles.fullCenter}>
        <div style={styles.loadingRow}>
          <div style={styles.spinner} />
          載入中...
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <div style={styles.sidebarWrap}>
        <Sidebar />
      </div>

      {/* Main */}
      <div style={styles.main}>
        {/* Top bar */}
        <div style={styles.topbar}>
          <div>
            <h1 style={styles.h1}>儀表板</h1>
            <div style={styles.sub}>{email}</div>
          </div>

          <button
            onClick={signOut}
            style={styles.signOutBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f9fafb";
              e.currentTarget.style.color = "#111827";
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#6b7280";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
          >
            <span style={{ fontSize: 16 }}>→</span>
            登出
          </button>
        </div>

        {/* Error */}
        {msg && (
          <div style={styles.alert}>
            <span>⚠️</span>
            {msg}
          </div>
        )}

        {/* Card */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.h2}>專案進度</h2>
          </div>

          <div style={styles.cardBody}>
            <ProjectProgressList />
          </div>

          {/* ✅ 這裡改成表格週排班顯示 */}
          <div style={styles.cardDividerBlock}>
            <div style={styles.sectionTitle}>行程規劃（週排班表）</div>
            <WeeklyGridReadOnly />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  fullCenter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    backgroundColor: "#ffffff",
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    color: "#4b5563",
    fontSize: 15,
  },
  spinner: {
    width: 20,
    height: 20,
    border: "2px solid #e5e7eb",
    borderTopColor: "#3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  shell: {
    display: "flex",
    minHeight: "100vh",
    backgroundColor: "#f3f4f6",
  },
  sidebarWrap: {
    width: 260,
    flexShrink: 0,
    backgroundColor: "white",
    borderRight: "1px solid #e5e7eb",
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: 24,
  },

  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 32,
  },
  h1: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    marginBottom: 6,
    color: "#111827",
  },
  sub: {
    fontSize: 13,
    color: "#6b7280",
  },

  signOutBtn: {
    padding: "8px 16px",
    fontSize: 14,
    color: "#6b7280",
    backgroundColor: "transparent",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.2s",
  },

  alert: {
    marginBottom: 24,
    padding: "12px 16px",
    backgroundColor: "#fef2f2",
    border: "1px solid #fee2e2",
    borderRadius: 8,
    color: "#b91c1c",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  card: {
    backgroundColor: "white",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  },
  cardHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  },
  h2: {
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
    color: "#374151",
  },
  cardBody: {
    padding: 20,
  },
  cardDividerBlock: {
    padding: "0 20px 20px 20px",
    borderTop: "1px solid #f3f4f6",
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "#4b5563",
    marginBottom: 12,
    marginTop: 16,
  },
};
