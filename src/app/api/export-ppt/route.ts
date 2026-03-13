import { NextRequest, NextResponse } from "next/server";
import pptxgen from "pptxgenjs";
import { createClient } from "@supabase/supabase-js";

type ScheduleItemRow = {
  id: string;
  engineer_id: string;
  work_date: string;
  project_id: string | null;
  title: string;
  details: string | null;
  item_type: "work" | "leave" | "move";
  priority: number | null;
  sort_order: number | null;
};

type ProjectRow = {
  id: string;
  name: string;
  description?: string | null; // 當專案編號，例如 ASAO-13-194
  progress?: Record<string, any> | null;
};

type EngineerRow = {
  id: string;
  name: string;
};

type IssueRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  severity: 1 | 2 | 3;
  status: "open" | "doing" | "done";
  created_at: string;
  updated_at: string;
};

type IssueCommentRow = {
  id: string;
  issue_id: string;
  content: string;
  created_at: string;
};

type UsageInfo = {
  totalDays: number;
  stageDays: Record<string, number>;
};

type IssueSummary = {
  title: string;
  severityText: string;
  status: "open" | "doing";
  latestAction: string;
};

const STAGES = [
  { key: "hardware_install", label: "硬體安裝", color: "3B82F6" },
  { key: "hardware_stability", label: "穩定性調整", color: "22C55E" },
  { key: "software_params", label: "軟體參數", color: "F97316" },
  { key: "ai_training", label: "AI訓練", color: "A855F7" },
  { key: "run_validation", label: "跑料驗證", color: "0EA5E9" },
  { key: "training", label: "教育訓練", color: "64748B" },
] as const;

function safe(v: unknown, fallback = "NA") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function fitTextBlock(text: string, maxLen = 260) {
  const s = (text || "").trim();
  if (!s) return "NA";
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}

function getStagePlan(progress: Record<string, any> | null | undefined, key: string) {
  const n = Number(progress?.[key]?.plan_days ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function getStagePercent(progress: Record<string, any> | null | undefined, key: string) {
  const n = Number(progress?.[key]?.percent ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function getProjectPlanDays(progress: Record<string, any> | null | undefined) {
  const n = Number(progress?._meta?.project_plan_days ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function toMMDD(iso: string) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

function parseTaggedDetails(title: string, details: string | null) {
  const raw = (details ?? "").trim();

  const result = {
    content: safe(title),
    detail: raw || "NA",
    nextAction: "NA",
    overtime: "無",
    followUp: "NA",
  };

  if (!raw) return result;

  const patterns = [
    { key: "content", names: ["內容", "content"] },
    { key: "detail", names: ["細節", "detail", "說明"] },
    { key: "nextAction", names: ["後日預計執行事項", "后日預計執行事項", "預計執行事項", "next action"] },
    { key: "overtime", names: ["加班", "overtime"] },
    { key: "followUp", names: ["follow up", "followup", "追蹤", "後續追蹤"] },
  ] as const;

  const lines = raw
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  let matchedAnyTag = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    for (const p of patterns) {
      for (const alias of p.names) {
        const aliasLower = alias.toLowerCase();
        if (lower.startsWith(aliasLower + ":") || lower.startsWith(aliasLower + "：")) {
          const value = line
            .slice(alias.length + 1)
            .replace(/^[:：]/, "")
            .trim();

          if (p.key === "content") result.content = value || result.content;
          if (p.key === "detail") result.detail = value || result.detail;
          if (p.key === "nextAction") result.nextAction = value || result.nextAction;
          if (p.key === "overtime") result.overtime = value || result.overtime;
          if (p.key === "followUp") result.followUp = value || result.followUp;

          matchedAnyTag = true;
        }
      }
    }
  }

  if (!matchedAnyTag) {
    result.content = safe(title);
    result.detail = raw;
  }

  return result;
}

function detectActionLabel(title: string) {
  const t = (title || "").trim();
  if (!t) return "作業";
  if (t.includes("安裝")) return "安裝";
  if (t.includes("驗證")) return "驗證";
  if (t.includes("教育")) return "教育訓練";
  if (t.includes("訓練")) return "訓練";
  if (t.includes("參數")) return "參數設定";
  if (t.includes("穩定")) return "穩定性調整";
  return "作業";
}

function severityText(sev: 1 | 2 | 3) {
  if (sev === 1) return "高";
  if (sev === 2) return "中";
  return "低";
}

function issueStatusText(status: "open" | "doing") {
  return status === "doing" ? "處理中" : "未處理";
}

function issueStatusColor(status: "open" | "doing") {
  return status === "doing" ? "B45309" : "374151";
}

function issueFillColor(status: "open" | "doing") {
  return status === "doing" ? "FFF7ED" : "F8FAFC";
}

function issueLineColor(status: "open" | "doing") {
  return status === "doing" ? "FDBA74" : "CBD5E1";
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL");
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY，請到 .env.local 補上");
    }

    const body = await req.json();
    const itemIds = Array.isArray(body?.itemIds) ? body.itemIds : [];

    if (itemIds.length === 0) {
      return NextResponse.json({ error: "請提供 itemIds" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const [
      { data: items, error: itemErr },
      { data: projects, error: projErr },
      { data: engineers, error: engErr },
    ] = await Promise.all([
      supabase
        .from("schedule_items")
        .select("id,engineer_id,work_date,project_id,title,details,item_type,priority,sort_order")
        .in("id", itemIds)
        .order("work_date", { ascending: true })
        .order("sort_order", { ascending: true }),

      supabase.from("projects").select("id,name,description,progress"),
      supabase.from("engineers").select("id,name"),
    ]);

    if (itemErr) throw new Error(`schedule_items 查詢失敗：${itemErr.message}`);
    if (projErr) throw new Error(`projects 查詢失敗：${projErr.message}`);
    if (engErr) throw new Error(`engineers 查詢失敗：${engErr.message}`);

    const itemRows = (items ?? []) as ScheduleItemRow[];
    const projectRows = (projects ?? []) as ProjectRow[];
    const engineerRows = (engineers ?? []) as EngineerRow[];

    if (itemRows.length === 0) {
      return NextResponse.json({ error: "查無可匯出的資料" }, { status: 404 });
    }

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));
    const engineerMap = new Map(engineerRows.map((e) => [e.id, e]));

    const projectIds = Array.from(new Set(itemRows.map((x) => x.project_id).filter(Boolean))) as string[];

    const usageMap = new Map<string, UsageInfo>();

    if (projectIds.length > 0) {
      const { data: usageRows, error: usageErr } = await supabase
        .from("schedule_items")
        .select("project_id,work_date,priority,item_type")
        .in("project_id", projectIds)
        .eq("item_type", "work");

      if (usageErr) {
        throw new Error(`schedule_items(usage) 查詢失敗：${usageErr.message}`);
      }

      const byProjectDateSet = new Map<string, Set<string>>();
      const byProjectStageDateSet = new Map<string, Map<string, Set<string>>>();

      for (const r of usageRows ?? []) {
        const pid = (r as any).project_id as string | null;
        const workDate = (r as any).work_date as string;
        const priority = Number((r as any).priority ?? NaN);

        if (!pid) continue;

        if (!byProjectDateSet.has(pid)) byProjectDateSet.set(pid, new Set<string>());
        byProjectDateSet.get(pid)!.add(workDate);

        let stageKey: string | null = null;
        if (Number.isFinite(priority) && priority >= 1 && priority <= 6) {
          stageKey = STAGES[Math.round(priority) - 1]?.key ?? null;
        }

        if (stageKey) {
          if (!byProjectStageDateSet.has(pid)) byProjectStageDateSet.set(pid, new Map());
          const m = byProjectStageDateSet.get(pid)!;
          if (!m.has(stageKey)) m.set(stageKey, new Set<string>());
          m.get(stageKey)!.add(workDate);
        }
      }

      for (const pid of projectIds) {
        const totalDays = byProjectDateSet.get(pid)?.size ?? 0;
        const stageDays: Record<string, number> = {};
        for (const s of STAGES) {
          stageDays[s.key] = byProjectStageDateSet.get(pid)?.get(s.key)?.size ?? 0;
        }
        usageMap.set(pid, { totalDays, stageDays });
      }
    }

    // ===== Issue 區塊資料 =====
    const issueMap = new Map<string, IssueSummary[]>();

    if (projectIds.length > 0) {
      const { data: issues, error: issueErr } = await supabase
        .from("issues")
        .select("id,project_id,title,description,severity,status,created_at,updated_at")
        .in("project_id", projectIds)
        .neq("status", "done")
        .order("updated_at", { ascending: false });

      if (issueErr) {
        throw new Error(`issues 查詢失敗：${issueErr.message}`);
      }

      const issueRows = (issues ?? []) as IssueRow[];
      const issueIds = issueRows.map((x) => x.id);

      const commentsByIssue = new Map<string, IssueCommentRow[]>();

      if (issueIds.length > 0) {
        const { data: comments, error: commentErr } = await supabase
          .from("issue_comments")
          .select("id,issue_id,content,created_at")
          .in("issue_id", issueIds)
          .order("created_at", { ascending: false });

        if (commentErr) {
          throw new Error(`issue_comments 查詢失敗：${commentErr.message}`);
        }

        for (const c of (comments ?? []) as IssueCommentRow[]) {
          const arr = commentsByIssue.get(c.issue_id) ?? [];
          arr.push(c);
          commentsByIssue.set(c.issue_id, arr);
        }
      }

      for (const issue of issueRows) {
        let latestAction = "";

        if (issue.status === "doing") {
          const latestComment = commentsByIssue.get(issue.id)?.[0];
          latestAction =
            latestComment?.content?.trim() ||
            issue.description?.trim() ||
            "處理中，尚未填寫最新處理事項";
        } else {
          latestAction = issue.description?.trim() || "未處理，尚未填寫說明";
        }

        const narrowedStatus: "open" | "doing" =
          issue.status === "doing" ? "doing" : "open";

        const row: IssueSummary = {
          title: safe(issue.title),
          severityText: severityText(issue.severity),
          status: narrowedStatus,
          latestAction,
        };

        const arr = issueMap.get(issue.project_id) ?? [];
        arr.push(row);
        issueMap.set(issue.project_id, arr);
      }
    }

    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "PM WebApp";
    pptx.company = "PM WebApp";
    pptx.subject = "自動匯出專案工作簡報";
    pptx.title = "專案工作匯出";

    let pageNo = 1;

    for (const it of itemRows) {
      const slide = pptx.addSlide();

      const project = it.project_id ? projectMap.get(it.project_id) : null;
      const engineerName = engineerMap.get(it.engineer_id)?.name ?? "未知工程師";

      const projectName = project?.name ?? "未指定專案";
      const projectCode = project?.description?.trim() || "NA";
      const productCategory = "";
      const parsed = parseTaggedDetails(it.title, it.details);
      const actionLabel = detectActionLabel(it.title);

      const projectProgress = project?.progress ?? null;
      const projectPlanDays = getProjectPlanDays(projectProgress);
      const usage = it.project_id ? usageMap.get(it.project_id) : undefined;
      const usedDays = usage?.totalDays ?? 0;
      const issueList = it.project_id ? issueMap.get(it.project_id) ?? [] : [];

      slide.background = { color: "FFFFFF" };

      // 標題
      slide.addText(projectName, {
        x: 3.05,
        y: 0.04,
        w: 4.0,
        h: 0.34,
        fontFace: "Arial",
        fontSize: 21,
        bold: true,
        color: "0070C0",
        align: "center",
      });

      // Description
      slide.addText("■ Description :", {
        x: 0.08,
        y: 0.28,
        w: 2.6,
        h: 0.28,
        fontFace: "Arial",
        fontSize: 18,
        bold: true,
        color: "1F32FF",
      });

      slide.addText(
        [
          { text: `1) ${projectCode}(專案編號) ${projectName}` },
          { text: `\n●責任歸屬：台責     ●保固狀況：驗收前     ●產品類別：${productCategory}` },
          { text: `\n●SAT(Site Acceptance Test,現場驗收測試) (目標VS實際):` },
        ],
        {
          x: 0.16,
          y: 0.58,
          w: 6.9,
          h: 0.9,
          fontFace: "Arial",
          fontSize: 11,
          bold: true,
          color: "111111",
          margin: 0.02,
          valign: "top",
        }
      );

      // Action
      slide.addText("■ Action:", {
        x: 0.08,
        y: 1.22,
        w: 2.1,
        h: 0.28,
        fontFace: "Arial",
        fontSize: 18,
        bold: true,
        color: "1F32FF",
      });

      slide.addText(`1) ${projectCode} - ${projectName} ${actionLabel}:`, {
        x: 0.16,
        y: 1.5,
        w: 4.0,
        h: 0.2,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      slide.addText(safe(it.title), {
        x: 2.55,
        y: 1.5,
        w: 1.5,
        h: 0.2,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      // 專案進度卡
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.18,
        y: 1.78,
        w: 6.95,
        h: 1.58,
        rectRadius: 0.06,
        line: { color: "D9DEE8", pt: 1 },
        fill: { color: "FFFFFF" },
      });

      slide.addText(projectName, {
        x: 0.28,
        y: 1.92,
        w: 1.35,
        h: 0.16,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
      });

      slide.addText(projectCode, {
        x: 0.28,
        y: 2.15,
        w: 1.1,
        h: 0.14,
        fontFace: "Arial",
        fontSize: 8,
        color: "6B7280",
      });

      slide.addText(toMMDD(it.work_date), {
        x: 0.28,
        y: 2.34,
        w: 0.7,
        h: 0.12,
        fontFace: "Arial",
        fontSize: 8,
        color: "94A3B8",
      });

      slide.addShape(pptx.ShapeType.line, {
        x: 1.58,
        y: 1.87,
        w: 0,
        h: 0.58,
        line: { color: "E5E7EB", pt: 1 },
      });

      let sx = 1.72;
      const sy = 1.90;
      const colW = 0.84;
      const barW = 0.72;

      for (const s of STAGES) {
        const pct = getStagePercent(projectProgress, s.key);
        const stagePlan = getStagePlan(projectProgress, s.key);
        const stageUsed = usage?.stageDays?.[s.key] ?? 0;

        slide.addText(s.label, {
          x: sx,
          y: sy,
          w: colW,
          h: 0.10,
          fontFace: "Arial",
          fontSize: 5.8,
          bold: true,
          color: "374151",
          align: "left",
          margin: 0,
          fit: "shrink",
        });

        slide.addText(`${stageUsed}/${stagePlan || 0}`, {
          x: sx,
          y: sy + 0.09,
          w: colW,
          h: 0.09,
          fontFace: "Arial",
          fontSize: 5.6,
          bold: true,
          color: stagePlan > 0 && stageUsed > stagePlan ? "DC2626" : "64748B",
          align: "right",
          margin: 0,
        });

        slide.addShape(pptx.ShapeType.roundRect, {
          x: sx,
          y: sy + 0.21,
          w: barW,
          h: 0.045,
          rectRadius: 0.02,
          line: { color: "EEF2F7", pt: 0.2 },
          fill: { color: "EEF2F7" },
        });

        slide.addShape(pptx.ShapeType.roundRect, {
          x: sx,
          y: sy + 0.21,
          w: barW * (pct / 100),
          h: 0.045,
          rectRadius: 0.02,
          line: { color: s.color, pt: 0.2 },
          fill: { color: s.color },
        });

        slide.addText(`${pct}%`, {
          x: sx,
          y: sy + 0.28,
          w: colW,
          h: 0.08,
          fontFace: "Arial",
          fontSize: 5.6,
          color: "374151",
          align: "right",
          margin: 0,
        });

        sx += 0.87;
      }

      slide.addText("整體完成進度", {
        x: 0.28,
        y: 2.72,
        w: 1.25,
        h: 0.11,
        fontFace: "Arial",
        fontSize: 8,
        bold: true,
        color: "374151",
      });

      const overallPct =
        STAGES.reduce((sum, s) => sum + getStagePercent(projectProgress, s.key), 0) / STAGES.length;

      slide.addText(`${Math.round(overallPct)}`, {
        x: 6.52,
        y: 2.69,
        w: 0.22,
        h: 0.13,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        align: "right",
      });

      slide.addText("%", {
        x: 6.54,
        y: 2.82,
        w: 0.16,
        h: 0.11,
        fontFace: "Arial",
        fontSize: 8,
        bold: true,
        color: "111111",
        align: "right",
      });

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.28,
        y: 2.98,
        w: 6.45,
        h: 0.07,
        rectRadius: 0.03,
        line: { color: "EEF2F7", pt: 0.2 },
        fill: { color: "EEF2F7" },
      });

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.28,
        y: 2.98,
        w: 6.45 * (Math.round(overallPct) / 100),
        h: 0.07,
        rectRadius: 0.03,
        line: { color: "3B82F6", pt: 0.2 },
        fill: { color: "3B82F6" },
      });

      slide.addText(`已使用 ${usedDays}/${projectPlanDays || 0} 天`, {
        x: 5.75,
        y: 3.12,
        w: 0.95,
        h: 0.09,
        fontFace: "Arial",
        fontSize: 6.5,
        color: "94A3B8",
        align: "right",
      });

      // 工作內容 / 異常問題
      slide.addText("2)工作內容、異常問題、狀態(實驗結果,數據....)已反應RD哪一些問題,敘述說明:", {
        x: 0.08,
        y: 3.48,
        w: 6.05,
        h: 0.18,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      slide.addText(`內容:${safe(parsed.content)}`, {
        x: 0.08,
        y: 3.74,
        w: 6.35,
        h: 0.16,
        fontFace: "Arial",
        fontSize: 10.5,
        color: "111111",
      });

      slide.addText(`細節:${fitTextBlock(parsed.detail, 220)}`, {
        x: 0.08,
        y: 3.96,
        w: 6.45,
        h: 0.40,
        fontFace: "Arial",
        fontSize: 10.5,
        color: "111111",
        margin: 0.01,
        valign: "top",
      });

      // ===== Issue 區塊（簡報格式）=====
      slide.addText("3) Issue追蹤（完成項目不列出，處理中顯示最新處理事項）", {
        x: 0.08,
        y: 4.42,
        w: 6.2,
        h: 0.18,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.12,
        y: 4.66,
        w: 6.55,
        h: 0.80,
        rectRadius: 0.03,
        line: { color: "E5E7EB", pt: 0.6 },
        fill: { color: "FFFFFF" },
      });

      if (issueList.length === 0) {
        slide.addText("（目前無未完成 Issue）", {
          x: 0.22,
          y: 4.96,
          w: 3.2,
          h: 0.14,
          fontFace: "Arial",
          fontSize: 10.5,
          color: "666666",
        });
      } else {
        const maxIssues = 3;
        issueList.slice(0, maxIssues).forEach((iss, idx) => {
          const cardY = 4.74 + idx * 0.24;

          slide.addShape(pptx.ShapeType.roundRect, {
            x: 0.22,
            y: cardY,
            w: 6.32,
            h: 0.20,
            rectRadius: 0.02,
            line: { color: issueLineColor(iss.status), pt: 0.5 },
            fill: { color: issueFillColor(iss.status) },
          });

          slide.addText(`[${issueStatusText(iss.status)}]`, {
            x: 0.30,
            y: cardY + 0.03,
            w: 0.55,
            h: 0.10,
            fontFace: "Arial",
            fontSize: 8.5,
            bold: true,
            color: issueStatusColor(iss.status),
            margin: 0,
          });

          slide.addText(`[${iss.severityText}]`, {
            x: 0.88,
            y: cardY + 0.03,
            w: 0.38,
            h: 0.10,
            fontFace: "Arial",
            fontSize: 8.5,
            bold: true,
            color: "991B1B",
            margin: 0,
          });

          slide.addText(fitTextBlock(iss.title, 20), {
            x: 1.30,
            y: cardY + 0.03,
            w: 1.55,
            h: 0.10,
            fontFace: "Arial",
            fontSize: 8.5,
            bold: true,
            color: "111111",
            margin: 0,
          });

          slide.addText(fitTextBlock(iss.latestAction, 58), {
            x: 2.95,
            y: cardY + 0.03,
            w: 3.45,
            h: 0.10,
            fontFace: "Arial",
            fontSize: 8.2,
            color: "374151",
            margin: 0,
          });
        });

        if (issueList.length > maxIssues) {
          slide.addText(`（其餘 ${issueList.length - maxIssues} 筆未完成 Issue 省略）`, {
            x: 0.22,
            y: 5.42,
            w: 3.0,
            h: 0.10,
            fontFace: "Arial",
            fontSize: 8.5,
            color: "6B7280",
          });
        }
      }

      // 後日預計執行事項
      slide.addText("4)后日預計執行事項", {
        x: 0.08,
        y: 5.56,
        w: 2.0,
        h: 0.18,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      slide.addText(`4-1) ${safe(parsed.nextAction)}`, {
        x: 0.18,
        y: 5.82,
        w: 4.8,
        h: 0.16,
        fontFace: "Arial",
        fontSize: 10.5,
        color: "111111",
      });

      // 加班
      slide.addText("5)加班", {
        x: 0.08,
        y: 6.10,
        w: 0.9,
        h: 0.18,
        fontFace: "Arial",
        fontSize: 11,
        bold: true,
        color: "111111",
        highlight: "FFF200",
      });

      slide.addText(safe(parsed.overtime, "無"), {
        x: 0.12,
        y: 6.34,
        w: 1.3,
        h: 0.15,
        fontFace: "Arial",
        fontSize: 10.5,
        color: "111111",
      });

      // Follow up
      slide.addText("Follow\nup:", {
        x: 0.1,
        y: 6.48,
        w: 0.9,
        h: 0.32,
        fontFace: "Arial",
        fontSize: 16,
        bold: true,
        color: "1F32FF",
        breakLine: false,
      });

      slide.addText(parsed.followUp !== "NA" ? parsed.followUp : projectName, {
        x: 1.45,
        y: 6.58,
        w: 2.8,
        h: 0.16,
        fontFace: "Arial",
        fontSize: 13,
        bold: true,
        color: "111111",
      });

      // 右下角日期工程師
      slide.addText(`日期：${it.work_date}  工程師：${engineerName}`, {
        x: 9.45,
        y: 6.78,
        w: 2.3,
        h: 0.12,
        fontFace: "Arial",
        fontSize: 8,
        color: "666666",
        align: "right",
      });

      // 頁腳
      slide.addText(String(pageNo), {
        x: 0.1,
        y: 7.12,
        w: 0.2,
        h: 0.12,
        fontFace: "Arial",
        fontSize: 9,
        color: "111111",
      });

      slide.addText("Delta Confidential", {
        x: 0.45,
        y: 7.12,
        w: 1.6,
        h: 0.12,
        fontFace: "Arial",
        fontSize: 9,
        color: "111111",
      });

      slide.addText("DELTA", {
        x: 11.1,
        y: 7.0,
        w: 1.05,
        h: 0.16,
        fontFace: "Arial",
        fontSize: 16,
        bold: true,
        color: "0070C0",
        align: "right",
      });

      pageNo += 1;
    }

    const buffer = (await pptx.write({
      outputType: "nodebuffer",
    } as any)) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": 'attachment; filename="project-export.pptx"',
      },
    });
  } catch (e: any) {
    console.error("export-ppt error:", e);

    return NextResponse.json(
      {
        error: e?.message ?? "匯出失敗",
        detail: String(e),
      },
      { status: 500 }
    );
  }
}