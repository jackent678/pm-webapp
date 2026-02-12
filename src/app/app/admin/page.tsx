"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type ProjectRow = { id: string; name: string };

type ProfileLite = { name: string | null };
type MaybeJoin<T> = T | T[] | null;

function normalizeJoin<T>(v: MaybeJoin<T>): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

type MemberRow = {
  project_id: string;
  user_id: string;
  role_in_project: "manager" | "member" | "viewer";
  profile: ProfileLite | null; // profiles.name
  email: string | null; // from user_emails view
};

type MyProfileRow = {
  id: string;
  name: string | null;
  is_admin: boolean;
};

export default function AdminPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [me, setMe] = useState<MyProfileRow | null>(null);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);

  // add member form
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [role, setRole] = useState<"manager" | "member" | "viewer">("member");
  const [saving, setSaving] = useState(false);

  async function ensureLoggedIn() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.replace("/login");
      throw new Error("未登入");
    }
    setMyEmail(data.user.email ?? null);
    return data.user;
  }

  async function loadMeProfile() {
    const u = await ensureLoggedIn();

    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,is_admin")
      .eq("id", u.id)
      .single();

    if (error) throw error;

    const p = data as MyProfileRow;
    setMe(p);

    if (!p.is_admin) {
      router.replace("/app");
      throw new Error("你不是主管（is_admin=false），無法進入 /app/admin");
    }
    return p;
  }

  async function loadProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setProjects((data ?? []) as ProjectRow[]);
  }

  async function loadMembers() {
    // 1) 先拿 project_members + profiles.name（可以 join profiles，因為 profiles 有 FK）
    const { data: pmData, error: pmErr } = await supabase
      .from("project_members")
      .select(
        `
        project_id,user_id,role_in_project,
        profile:profiles!project_members_user_id_fkey(name)
      `
      )
      .order("created_at", { ascending: false });

    if (pmErr) throw pmErr;

    const base = (pmData ?? []).map((r: any) => ({
      project_id: r.project_id as string,
      user_id: r.user_id as string,
      role_in_project: r.role_in_project as "manager" | "member" | "viewer",
      profile: normalizeJoin<ProfileLite>(r.profile),
      email: null as string | null,
    }));

    // 2) 再用 user_id 批次查 user_emails（view，不能 join，只能查）
    const userIds = Array.from(new Set(base.map((x) => x.user_id)));

    let emailMap = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: emData, error: emErr } = await supabase
        .from("user_emails")
        .select("user_id,email")
        .in("user_id", userIds);

      if (emErr) throw emErr;

      for (const row of emData ?? []) {
        emailMap.set(row.user_id as string, (row.email as string | null) ?? null);
      }
    }

    // 3) 合併回去
    const merged: MemberRow[] = base.map((m) => ({
      ...m,
      email: emailMap.get(m.user_id) ?? null,
    }));

    setMembers(merged);
  }

  async function refreshAll() {
    setMsg("");
    try {
      await loadMeProfile();
      await loadProjects();
      await loadMembers();
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    }
  }

  async function changeRole(project_id: string, user_id: string, newRole: MemberRow["role_in_project"]) {
    setMsg("");
    try {
      await loadMeProfile();
      const { error } = await supabase
        .from("project_members")
        .update({ role_in_project: newRole })
        .eq("project_id", project_id)
        .eq("user_id", user_id);

      if (error) throw error;
      await loadMembers();
      setMsg("✅ 已更新角色");
    } catch (e: any) {
      setMsg("❌ 更新角色失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function removeMember(project_id: string, user_id: string) {
    setMsg("");
    const ok = confirm("確定要移除此成員？");
    if (!ok) return;

    try {
      await loadMeProfile();
      const { error } = await supabase
        .from("project_members")
        .delete()
        .eq("project_id", project_id)
        .eq("user_id", user_id);

      if (error) throw error;
      await loadMembers();
      setMsg("✅ 已移除成員");
    } catch (e: any) {
      setMsg("❌ 移除失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function findUserIdByEmail(email: string) {
    const { data, error } = await supabase
      .from("user_emails")
      .select("user_id,email")
      .ilike("email", email)
      .maybeSingle();

    if (error) throw error;
    return (data?.user_id as string | undefined) ?? null;
  }

  async function addMember() {
    setMsg("");
    try {
      await loadMeProfile();

      if (!selectedProjectId) return setMsg("請選擇專案");
      if (!userEmail.trim()) return setMsg("請輸入使用者 email");

      setSaving(true);

      const uid = await findUserIdByEmail(userEmail.trim());
      if (!uid) {
        setMsg("找不到此 email 的使用者（他必須先登入過系統，auth.users 才會有資料）");
        return;
      }

      const { error } = await supabase.from("project_members").upsert(
        {
          project_id: selectedProjectId,
          user_id: uid,
          role_in_project: role,
        },
        { onConflict: "project_id,user_id" }
      );

      if (error) throw error;

      setUserEmail("");
      setRole("member");
      await loadMembers();
      setMsg("✅ 已新增/更新成員");
    } catch (e: any) {
      setMsg("❌ 新增成員失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }

  const membersByProject = useMemo(() => {
    const map = new Map<string, MemberRow[]>();
    for (const m of members) {
      const arr = map.get(m.project_id) ?? [];
      arr.push(m);
      map.set(m.project_id, arr);
    }
    return map;
  }, [members]);

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />

      <div style={{ flex: 1, padding: 18, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>主管專區 / Admin</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              目前登入：{myEmail ?? "-"}（is_admin={String(me?.is_admin ?? false)}）
            </div>
          </div>
          <button onClick={refreshAll} style={{ padding: "6px 10px", cursor: "pointer" }}>
            重新整理
          </button>
        </div>

        {msg && <p style={{ marginTop: 10, color: msg.startsWith("✅") ? "#0a0" : "#d11" }}>{msg}</p>}

        {/* Add / update member */}
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <div style={{ fontWeight: 900 }}>新增/更新專案成員</div>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              style={{ padding: 10, borderRadius: 8 }}
            >
              <option value="">請選擇專案</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <input
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="成員 email（他必須先登入過系統）"
              style={{ padding: 10, borderRadius: 8 }}
            />

            <select value={role} onChange={(e) => setRole(e.target.value as any)} style={{ padding: 10, borderRadius: 8 }}>
              <option value="manager">manager（可管理專案）</option>
              <option value="member">member（一般成員）</option>
              <option value="viewer">viewer（只能看）</option>
            </select>

            <button
              onClick={addMember}
              disabled={saving}
              style={{
                padding: "10px 14px",
                cursor: saving ? "not-allowed" : "pointer",
                borderRadius: 8,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "儲存中..." : "新增/更新成員"}
            </button>
          </div>
        </div>

        {/* Projects & members */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 900 }}>專案成員總覽</div>

          {projects.length === 0 ? (
            <p style={{ marginTop: 10 }}>目前沒有專案</p>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
              {projects.map((p) => {
                const list = membersByProject.get(p.id) ?? [];
                return (
                  <div key={p.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>{p.name}</div>

                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      {list.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>（尚無成員，請上方新增）</div>
                      ) : (
                        list.map((m) => (
                          <div
                            key={`${m.project_id}_${m.user_id}`}
                            style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}
                          >
                            <div style={{ fontSize: 13 }}>
                              <div style={{ fontWeight: 800 }}>{m.profile?.name ?? "（無姓名）"}</div>
                              <div style={{ opacity: 0.8 }}>{m.email ?? m.user_id}</div>
                            </div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <select
                                value={m.role_in_project}
                                onChange={(e) => changeRole(m.project_id, m.user_id, e.target.value as any)}
                                style={{ padding: 8, borderRadius: 8 }}
                              >
                                <option value="manager">manager</option>
                                <option value="member">member</option>
                                <option value="viewer">viewer</option>
                              </select>

                              <button
                                onClick={() => removeMember(m.project_id, m.user_id)}
                                style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
                              >
                                移除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>project_id: {p.id}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
