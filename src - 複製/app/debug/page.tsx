"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function DebugPage() {
  const [status, setStatus] = useState("checking...");
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        const { data: userData, error: userErr } = await supabase.auth.getUser();

        setInfo({
          env: {
            hasUrl: Boolean(url),
            hasKey: Boolean(key),
            urlPreview: url ? url.slice(0, 28) + "..." : null,
            keyPreview: key ? key.slice(0, 16) + "..." : null,
          },
          auth: {
            hasUser: Boolean(userData.user),
            userEmail: userData.user?.email ?? null,
            userId: userData.user?.id ?? null,
            error: userErr?.message ?? null,
          },
        });

        if (!url || !key) {
          setStatus("❌ env 沒讀到（請檢查 .env.local + 重啟 dev server）");
          return;
        }
        setStatus("✅ Supabase client 初始化成功（下一步做登入）");
      } catch (e: any) {
        setStatus("❌ 發生錯誤：" + (e?.message ?? "unknown"));
      }
    })();
  }, []);0

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Debug</h1>
      <p>{status}</p>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 8 }}>
        {JSON.stringify(info, null, 2)}
      </pre>
      <p style={{ marginTop: 10 }}>
        你現在可以去 <a href="/login">/login</a> 做登入頁（下一步我帶你做）。
      </p>
    </div>
  );
}
