"use client";

import { useEffect, useState } from "react";
import Sidebar from "../../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type ProjectRow = { id: string; name: string };
type ProfileLite = { name: string | null };
type MaybeProfileJoin = ProfileLite | ProfileLite[] | null;

type IssueRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  severity: 1 | 2 | 3;
  status: "open" | "doing" | "done";
  reporter_id: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  assignee: ProfileLite | null;
};

type CommentRow = {
  id: string;
  issue_id: string;
  author_id: string | null;
  content: string;
  created_at: string;
  author: ProfileLite | null;
};

function normalizeProfile(p: MaybeProfileJoin): ProfileLite | null {
  if (!p) return null;
  if (Array.isArray(p)) return p[0] ?? null;
  return p;
}

export default function IssueDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const issueId = params?.id;

  const [msg, setMsg] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [issue, setIssue] = useState<IssueRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [newComment, setNewComment] = useState("");

  async function ensureLoggedIn() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.replace("/login");
      throw new Error("未登入");
    }
    return data.user;
  }

  async function loadProjects() {
    const { data, error } = await supabase.from("projects").select("id,name");
    if (error) throw error;
    setProjects((data ?? []) as ProjectRow[]);
  }

  function projectName(id: string) {
    return projects.find((p) => p.id === id)?.name ?? "（未知專案）";
  }

  async function loadIssue() {
    if (!issueId) return;

    const { data, error } = await supabase
      .from("issues")
      .select(
        `
        id,project_id,title,description,severity,status,reporter_id,assignee_id,created_at,updated_at,
        assignee:profiles!issues_assignee_id_fkey(name)
      `
      )
      .eq("id", issueId)
      .single();

    if (error) throw error;

    const normalized: IssueRow = {
      ...(data as any),
      assignee: normalizeProfile((data as any).assignee as MaybeProfileJoin),
    };

    setIssue(normalized);
  }

  async function loadComments() {
    if (!issueId) return;

    const { data, error } = await supabase
      .from("issue_comments")
      .select(
        `
        id,issue_id,author_id,content,created_at,
        author:profiles!issue_comments_author_id_fkey(name)
      `
      )
      .eq("issue_id", issueId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const normalized = (data ?? []).map((row: any) => ({
      ...row,
      author: normalizeProfile(row.author as MaybeProfileJoin),
    })) as CommentRow[];

    setComments(normalized);
  }

  async function refreshAll() {
    setMsg("");
    try {
      await ensureLoggedIn();
      await loadProjects();
      await loadIssue();
      await loadComments();
    } catch (e: any) {
      setMsg("❌ 讀取失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function setIssueStatus(status: "open" | "doing" | "done") {
    setMsg("");
    try {
      await ensureLoggedIn();
      if (!issueId) return;

      const { error } = await supabase
        .from("issues")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", issueId);

      if (error) throw error;
      await loadIssue();
      setMsg("✅ 已更新狀態");
    } catch (e: any) {
      setMsg("❌ 更新狀態失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function assignToMe() {
    setMsg("");
    try {
      const user = await ensureLoggedIn();
      if (!issueId) return;

      const { error } = await supabase
        .from("issues")
        .update({ assignee_id: user.id, updated_at: new Date().toISOString() })
        .eq("id", issueId);

      if (error) throw error;
      await loadIssue();
      setMsg("✅ 已指派給自己");
    } catch (e: any) {
      setMsg("❌ 指派失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function addComment() {
    setMsg("");
    try {
      const user = await ensureLoggedIn();
      if (!issueId) return;

      if (!newComment.trim()) {
        setMsg("請輸入留言內容");
        return;
      }

      const { error } = await supabase.from("issue_comments").insert({
        issue_id: issueId,
        author_id: user.id,
        content: newComment.trim(),
      });

      if (error) throw error;

      setNewComment("");
      await loadComments();
      setMsg("✅ 已新增留言");
    } catch (e: any) {
      setMsg("❌ 新增留言失敗：" + (e?.message ?? "unknown"));
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />

      <div style={{ flex: 1, padding: 18, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Issue 詳細</div>
            <div style={{ marginTop: 6 }}>
              <Link href="/app/issues" style={{ textDecoration: "none" }}>
                ← 回到異常列表
              </Link>
            </div>
          </div>

          <button onClick={refreshAll} style={{ padding: "6px 10px", cursor: "pointer" }}>
            重新整理
          </button>
        </div>

        {msg && <p style={{ marginTop: 10, color: msg.startsWith("✅") ? "#0a0" : "#d11" }}>{msg}</p>}

        {!issue ? (
          <p style={{ marginTop: 14 }}>Loading...</p>
        ) : (
          <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{issue.title}</div>

            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
              專案：{projectName(issue.project_id)} · 嚴重度：
              {issue.severity === 1 ? "高" : issue.severity === 2 ? "中" : "低"} · 狀態：
              {issue.status === "open" ? "未處理" : issue.status === "doing" ? "處理中" : "完成"}
            </div>

            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
              負責人：{issue.assignee?.name ?? "（未指派）"}
            </div>

            {issue.description && <div style={{ marginTop: 12 }}>{issue.description}</div>}

            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
              建立：{new Date(issue.created_at).toLocaleString()} · 更新：
              {new Date(issue.updated_at).toLocaleString()}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={assignToMe}
                style={{ padding: "8px 10px", cursor: "pointer", borderRadius: 8 }}
              >
                指派給我
              </button>

              {(["open", "doing", "done"] as const).map((s) => {
                const active = issue.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setIssueStatus(s)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: active ? "1px solid #2563eb" : "1px solid #ddd",
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                  >
                    {s === "open" ? "未處理" : s === "doing" ? "處理中" : "完成"}
                  </button>
                );
              })}
            </div>

            <hr style={{ margin: "16px 0" }} />

            <div style={{ fontWeight: 900 }}>留言討論</div>

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="輸入留言..."
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
              />
              <button onClick={addComment} style={{ padding: "10px 14px", cursor: "pointer" }}>
                送出
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {comments.length === 0 ? (
                <div style={{ opacity: 0.75 }}>（尚無留言）</div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {c.author?.name ?? "（未知作者）"}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {new Date(c.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ marginTop: 6 }}>{c.content}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>id: {issue.id}</div>
          </div>
        )}
      </div>
    </div>
  );
}
