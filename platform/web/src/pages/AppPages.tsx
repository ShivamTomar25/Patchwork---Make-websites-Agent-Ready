import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BadgeCheck, CheckCircle2, CircleStop, Clock, ExternalLink, FolderPlus, GitBranch, KeyRound, Play, Plus, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { z } from "zod";
import { API_BASE, api } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label, Textarea } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../components/ui/toast";
import { cn, statusTone } from "../lib/utils";

type AppPage =
  | "dashboard"
  | "projects"
  | "project-new"
  | "project-detail"
  | "environments"
  | "journeys"
  | "journey-new"
  | "journey-detail"
  | "agents"
  | "experiments"
  | "project-experiments"
  | "experiment-new"
  | "experiment-detail"
  | "trajectories"
  | "failures"
  | "patches"
  | "confirmation"
  | "run-report"
  | "certificates"
  | "reports"
  | "integrations"
  | "team"
  | "settings-profile"
  | "settings-security"
  | "settings-organization"
  | "billing"
  | "audit-logs";

const projectSchema = z.object({ name: z.string().min(2), mode: z.enum(["scan", "repair"]), repositoryUrl: z.string().optional() });
const journeySchema = z.object({
  name: z.string().min(2),
  instruction: z.string().min(10),
  startCheckpoint: z.string().min(1),
  successPredicates: z.string().min(3),
  safetyInvariants: z.string().min(3)
});
const experimentSchema = z.object({
  name: z.string().min(2),
  executionMode: z.enum(["mock", "real-local-pilot"]),
  journeyId: z.string().min(1),
  agentId: z.string().min(1),
  defects: z.string().optional()
});

export default function AppPages({ page }: { page: AppPage }) {
  if (page === "dashboard") return <Dashboard />;
  if (page === "projects") return <Projects />;
  if (page === "project-new") return <NewProject />;
  if (page === "project-detail") return <ProjectDetail />;
  if (page === "environments") return <Environments />;
  if (page === "journeys") return <Journeys />;
  if (page === "journey-new") return <NewJourney />;
  if (page === "journey-detail") return <JourneyDetail />;
  if (page === "agents") return <Agents />;
  if (page === "experiments" || page === "project-experiments") return <Experiments />;
  if (page === "experiment-new") return <NewExperiment />;
  if (page === "experiment-detail") return <ExperimentDetail section="overview" />;
  if (page === "trajectories") return <ExperimentDetail section="trajectories" />;
  if (page === "failures") return <ExperimentDetail section="failures" />;
  if (page === "patches") return <ExperimentDetail section="patches" />;
  if (page === "confirmation") return <ExperimentDetail section="confirmation" />;
  if (page === "run-report") return <ExperimentDetail section="report" />;
  if (page === "certificates") return <Certificates />;
  if (page === "reports") return <Reports />;
  if (page === "integrations") return <Integrations />;
  if (page === "team") return <Team />;
  if (page === "audit-logs") return <AuditLogs />;
  return <Settings page={page} />;
}

function Dashboard() {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api<any>("/dashboard") });
  if (dashboard.isLoading) return <LoadingGrid />;
  const metrics = dashboard.data?.metrics || {};
  const chart = (dashboard.data?.recentRuns || []).map((run: any, index: number) => ({ name: `Run ${index + 1}`, success: run.successRate * 100, violations: run.violationCount }));
  return (
    <Page title="Overview" subtitle="Runs, repairs and proof." action={<Link to="/app/projects/new"><Button><FolderPlus className="h-4 w-4" /> New project</Button></Link>}>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Projects" value={metrics.projects} icon={GitBranch} />
        <Metric label="Recent experiments" value={metrics.recentExperiments} icon={Activity} />
        <Metric label="Compliant success" value={`${metrics.compliantSuccessRate || 0}%`} icon={CheckCircle2} />
        <Metric label="Violations" value={metrics.violations} icon={AlertTriangle} />
        <Metric label="Certified" value={metrics.certifiedResults} icon={BadgeCheck} />
        <Metric label="Approvals" value={metrics.pendingApprovals} icon={Clock} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.5fr_0.8fr]">
        <Card className="surface-float">
          <CardHeader><CardTitle>Experiment trend</CardTitle><Badge>last runs</Badge></CardHeader>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--text-primary) 12%, transparent)" />
                <XAxis dataKey="name" stroke="var(--text-tertiary)" />
                <YAxis stroke="var(--text-tertiary)" />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="success" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="surface-float">
          <CardTitle>Controls</CardTitle>
          <div className="mt-4 grid gap-3">
            <Row title="Confirmation" meta="Independent replay" status="verified" />
            <Row title="Secrets" meta="Redacted" status="passed" />
            <Row title="Scope" meta="Local and staging" status="recorded" />
            <Row title="Review" meta={`${metrics.pendingApprovals || 0} waiting`} status={metrics.pendingApprovals ? "open" : "clear"} />
          </div>
        </Card>
      </div>
      <RunList runs={dashboard.data?.recentRuns || []} />
    </Page>
  );
}

function Projects() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<any>("/projects") });
  return (
    <Page title="Projects" action={<Link to="/app/projects/new"><Button><Plus className="h-4 w-4" /> New project</Button></Link>}>
      {projects.isLoading ? <LoadingGrid /> : <div className="grid gap-4 md:grid-cols-3">{projects.data.projects.map((project: any) => <ProjectCard key={project.id} project={project} />)}</div>}
    </Page>
  );
}

function ProjectCard({ project }: { project: any }) {
  return (
    <Link to={`/app/projects/${project.id}`}>
      <Card className="h-full transition hover:border-orange-500/40">
        <div className="flex items-start justify-between">
          <CardTitle>{project.name}</CardTitle>
          <Badge>{project.mode}</Badge>
        </div>
        <p className="mt-3 text-sm text-neutral-600">{project.repositoryStatus}</p>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-neutral-600">
          <span>{project.environments?.length || 0} envs</span>
          <span>{project.journeys?.length || 0} journeys</span>
          <span>{project.certificates?.length || 0} certs</span>
        </div>
      </Card>
    </Link>
  );
}

function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof projectSchema>>({ resolver: zodResolver(projectSchema), defaultValues: { name: "", mode: "scan", repositoryUrl: "" } });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof projectSchema>) => api<any>("/projects", { method: "POST", body }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.show("Project created");
      navigate(`/app/projects/${data.project.id}`);
    }
  });
  return <ProjectForm title="New project" form={form} onSubmit={(values) => mutation.mutate(values)} pending={mutation.isPending} />;
}

function ProjectDetail() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  if (project.isLoading) return <LoadingGrid />;
  const item = project.data.project;
  return (
    <Page title={item.name} action={<Link to={`/app/projects/${item.id}/experiments/new`}><Button><Play className="h-4 w-4" /> Start mock run</Button></Link>}>
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Repository" value={item.repositoryStatus} icon={GitBranch} />
        <Metric label="Environment health" value={item.environments?.[0]?.healthStatus || "unknown"} icon={Activity} />
        <Metric label="Journeys" value={item.journeys?.length || 0} icon={SlidersHorizontal} />
        <Metric label="Certificates" value={item.certificates?.length || 0} icon={ShieldCheck} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardTitle>Journeys</CardTitle><List items={item.journeys || []} to={(journey: any) => `/app/projects/${item.id}/journeys/${journey.id}`} /></Card>
        <Card><CardTitle>Latest runs</CardTitle><List items={item.experiments || []} /></Card>
      </div>
    </Page>
  );
}

function Environments() {
  const { projectId } = useParams();
  const environments = useQuery({ queryKey: ["environments", projectId], queryFn: () => api<any>(`/projects/${projectId}/environments`) });
  return (
    <Page title="Environments">
      <Card>
        <div className="grid gap-3">
          {environments.data?.environments?.map((env: any) => (
            <Row key={env.id} title={env.name} meta={`${env.url} · ${env.type} · ${env.branch || "no branch"}`} status={env.healthStatus} />
          )) || <Skeleton className="h-20" />}
        </div>
      </Card>
    </Page>
  );
}

function Journeys() {
  const { projectId } = useParams();
  const journeys = useQuery({ queryKey: ["journeys", projectId], queryFn: () => api<any>(`/projects/${projectId}/journeys`) });
  return (
    <Page title="Journeys" action={<Link to={`/app/projects/${projectId}/journeys/new`}><Button><Plus className="h-4 w-4" /> New journey</Button></Link>}>
      <div className="grid gap-4 md:grid-cols-2">{journeys.data?.journeys?.map((journey: any) => <JourneyCard key={journey.id} projectId={projectId!} journey={journey} />) || <LoadingGrid />}</div>
    </Page>
  );
}

function JourneyCard({ projectId, journey }: { projectId: string; journey: any }) {
  return (
    <Link to={`/app/projects/${projectId}/journeys/${journey.id}`}>
      <Card className="h-full">
        <CardTitle>{journey.name}</CardTitle>
        <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{journey.instruction}</p>
        <div className="mt-4 flex flex-wrap gap-2">{journey.predicates?.slice(0, 3).map((p: any) => <Badge key={p.id}>{p.type}</Badge>)}</div>
      </Card>
    </Link>
  );
}

function NewJourney() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<z.infer<typeof journeySchema>>({ resolver: zodResolver(journeySchema), defaultValues: { name: "", instruction: "", startCheckpoint: "/", successPredicates: "", safetyInvariants: "" } });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof journeySchema>) =>
      api<any>(`/projects/${projectId}/journeys`, {
        method: "POST",
        body: { ...values, successPredicates: splitLines(values.successPredicates), safetyInvariants: splitLines(values.safetyInvariants) }
      }),
    onSuccess: (data) => {
      toast.show("Journey created");
      navigate(`/app/projects/${projectId}/journeys/${data.journey.id}`);
    }
  });
  return <JourneyForm title="New journey" form={form} onSubmit={(values) => mutation.mutate(values)} pending={mutation.isPending} />;
}

function JourneyDetail() {
  const { projectId, journeyId } = useParams();
  const journey = useQuery({ queryKey: ["journey", projectId, journeyId], queryFn: () => api<any>(`/projects/${projectId}/journeys/${journeyId}`) });
  if (journey.isLoading) return <LoadingGrid />;
  const item = journey.data.journey;
  return (
    <Page title={item.name}>
      <Card><CardTitle>Instruction</CardTitle><p className="mt-3 text-neutral-700">{item.instruction}</p></Card>
      <Card>
        <CardTitle>Visual contract-state editor</CardTitle>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {item.predicates.map((predicate: any) => <Row key={predicate.id} title={predicate.text} meta={predicate.type} status={predicate.required ? "required" : "optional"} />)}
        </div>
      </Card>
    </Page>
  );
}

function Agents() {
  const { projectId } = useParams();
  const agents = useQuery({ queryKey: ["agents", projectId], queryFn: () => api<any>(`/projects/${projectId}/agent-configurations`) });
  return (
    <Page title="Agent configurations">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.data?.agents?.map((agent: any) => (
          <Card key={agent.id}>
            <div className="flex items-start justify-between"><CardTitle>{agent.name}</CardTitle><Badge>{agent.enabled ? "enabled" : "disabled"}</Badge></div>
            <p className="mt-2 text-sm text-neutral-600">{agent.kind.replaceAll("_", " ")} · {agent.provider || "not configured"}</p>
            <p className="mt-4 text-xs text-neutral-500">Secret values are never displayed.</p>
          </Card>
        )) || <LoadingGrid />}
      </div>
    </Page>
  );
}

function Experiments() {
  const experiments = useQuery({ queryKey: ["experiments"], queryFn: () => api<any>("/experiments") });
  return (
    <Page title="Experiments">
      <div className="grid gap-3">
        {experiments.data?.experiments?.map((experiment: any) => (
          <Card key={experiment.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><CardTitle>{experiment.name}</CardTitle><p className="mt-1 text-sm text-neutral-600">{experiment.project.name}</p></div>
              {experiment.runs?.[0] ? <Link to={`/app/experiments/${experiment.runs[0].id}`}><Button variant="secondary">Open run</Button></Link> : <Badge>draft</Badge>}
            </div>
          </Card>
        )) || <LoadingGrid />}
      </div>
    </Page>
  );
}

function NewExperiment() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<z.infer<typeof experimentSchema>>({
    resolver: zodResolver(experimentSchema),
    defaultValues: { name: "PATCHWORK pilot review", executionMode: "mock", journeyId: "", agentId: "", defects: "" }
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof experimentSchema>) =>
      api<any>("/experiments", {
        method: "POST",
        body: {
          projectId,
          name: values.name,
          journeyIds: [values.journeyId],
          agentIds: [values.agentId],
          seeds: [1],
          defects: parseDefects(values.defects),
          executionMode: values.executionMode,
          startMockRun: true
        }
      }),
    onSuccess: (data, values) => {
      toast.show(values.executionMode === "real-local-pilot" ? "Real local pilot started" : "Mock experiment started");
      navigate(`/app/experiments/${data.runId}`);
    }
  });
  if (project.isLoading) return <LoadingGrid />;
  return (
    <Page title="New experiment">
      <Card>
        <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <Field label="Name"><Input {...form.register("name")} /></Field>
          <Field label="Mode"><select className="h-10 rounded-md border border-neutral-950/20 bg-white px-3 text-sm text-neutral-950" {...form.register("executionMode")}><option value="mock">Mock</option><option value="real-local-pilot">Real local pilot</option></select></Field>
          <Field label="Journey"><select className="h-10 rounded-md border border-neutral-950/20 bg-white px-3 text-sm text-neutral-950" {...form.register("journeyId")}><option value="">Select journey</option>{project.data.project.journeys.map((j: any) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></Field>
          <Field label="Agent"><select className="h-10 rounded-md border border-neutral-950/20 bg-white px-3 text-sm text-neutral-950" {...form.register("agentId")}><option value="">Select agent</option>{project.data.project.agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Defects"><Input {...form.register("defects")} placeholder="SHOP-IDEMP-001=true" /></Field>
          <Button disabled={mutation.isPending}><Play className="h-4 w-4" /> Start run</Button>
        </form>
      </Card>
    </Page>
  );
}

function ExperimentDetail({ section }: { section: "overview" | "trajectories" | "failures" | "patches" | "confirmation" | "report" }) {
  const { runId } = useParams();
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api<any>(`/experiments/${runId}`), refetchInterval: 3000 });
  const queryClient = useQueryClient();
  const toast = useToast();
  const patchDecision = useMutation({
    mutationFn: ({ patchId, decision }: { patchId: string; decision: "approved" | "rejected" }) => api(`/patches/${patchId}/decision`, { method: "POST", body: { decision } }),
    onSuccess: async () => {
      toast.show("Patch decision recorded");
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
  });
  const confirmation = useMutation({
    mutationFn: () => api(`/experiments/${runId}/confirmation`, { method: "POST" }),
    onSuccess: async () => {
      toast.show("Fresh confirmation started");
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
  });
  const cancel = useMutation({
    mutationFn: () => api(`/experiments/${runId}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      toast.show("Cancellation requested");
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
  });
  const resume = useMutation({
    mutationFn: () => api(`/experiments/${runId}/resume`, { method: "POST" }),
    onSuccess: async () => {
      toast.show("Resume requested");
      await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
  });
  if (run.isLoading) return <LoadingGrid />;
  const data = run.data;
  const tabs = ["overview", "trajectories", "failures", "patches", "confirmation", "report"];
  return (
    <Page title={data.run.experiment.name}>
      <div className="flex flex-wrap gap-2">{tabs.map((tab) => <Link key={tab} to={tab === "overview" ? `/app/experiments/${runId}` : `/app/experiments/${runId}/${tab === "report" ? "report" : tab}`}><Badge className={section === tab ? "border-orange-500 bg-orange-500 text-neutral-950" : ""}>{tab}</Badge></Link>)}</div>
      {section === "overview" && (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <Metric label="Status" value={data.run.status} icon={Activity} />
            <Metric label="Engine" value={data.run.engineMode || "mock"} icon={SlidersHorizontal} />
            <Metric label="Success" value={`${Math.round(data.run.successRate * 100)}%`} icon={CheckCircle2} />
            <Metric label="Violations" value={data.run.violationCount} icon={AlertTriangle} />
            <Metric label="Tokens" value={data.run.inputTokens + data.run.outputTokens} icon={KeyRound} />
          </div>
          {data.run.externalExperimentId ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>External harness</CardTitle>
                  <p className="mt-2 text-sm text-neutral-600">{data.run.externalExperimentId}</p>
                </div>
                <div className="flex gap-2">
                  {["failed", "cancelled"].includes(data.run.status) ? <Button variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}><Play className="h-4 w-4" /> Resume</Button> : null}
                  {["queued", "running"].includes(data.run.status) ? <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}><CircleStop className="h-4 w-4" /> Cancel</Button> : <Badge>{data.run.status}</Badge>}
                </div>
              </div>
            </Card>
          ) : null}
          {data.run.summaryMetrics ? <SummaryMetrics metrics={data.run.summaryMetrics} /> : null}
          {data.repair ? <RepairSummary repair={data.repair} /> : null}
          <Card><CardTitle>Status timeline</CardTitle><div className="mt-4 grid gap-3">{data.events.map((event: any) => <Row key={event.id} title={event.message} meta={new Date(event.createdAt).toLocaleString()} status={event.type} />)}</div></Card>
        </>
      )}
      {section === "trajectories" && <Card><CardTitle>Step timeline</CardTitle><div className="mt-4 grid gap-3">{data.run.steps?.length ? data.run.steps.map((step: any) => <Row key={step.id} title={`${step.index}. ${step.action}`} meta={`${step.url} · ${step.observation}${step.screenshot ? ` · ${step.screenshot}` : ""}`} status={step.verifier?.passed ? "passed" : "recorded"} />) : <Empty title="No trajectory steps recorded" />}</div></Card>}
      {section === "failures" && <div className="grid gap-4"><Card><CardTitle>Failure analysis</CardTitle><div className="mt-4 grid gap-3">{data.failures.length ? data.failures.map((failure: any) => <Row key={failure.id} title={failure.firstPredicate} meta={`Evidence: ${(failure.affectedComponents || []).join(", ")} ${failure.evidence?.resultPath || ""}`} status={failure.severity} />) : <Empty title="No failures recorded" />}</div></Card>{data.repair ? <RepairFailureEvidence repair={data.repair} /> : null}</div>}
      {section === "patches" && <div className="grid gap-4">{data.patches.length ? data.patches.map((patch: any) => <Card key={patch.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{patch.title}</CardTitle><p className="mt-2 text-sm text-neutral-600">{patch.summary}</p></div><Badge>{patch.status}</Badge></div><pre className="mt-4 overflow-auto rounded-lg border border-neutral-950/10 bg-white p-4 text-xs text-neutral-800">{patch.diff}</pre><div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => patchDecision.mutate({ patchId: patch.id, decision: "approved" })}>Approve</Button><Button variant="danger" onClick={() => patchDecision.mutate({ patchId: patch.id, decision: "rejected" })}>Reject</Button></div></Card>) : <Card><Empty title="No patch candidates for this pilot run" /></Card>}{data.repair ? <RepairPatchEvidence repair={data.repair} /> : null}{data.repair?.searchCertification ? <SearchPatchEvidence search={data.repair.searchCertification} /> : null}</div>}
      {section === "confirmation" && <div className="grid gap-4"><Card><CardTitle>Independent confirmation</CardTitle><div className="mt-4 grid gap-3">{data.confirmations.map((item: any) => <Row key={item.id} title={item.notes} meta={`success ${Math.round(item.successBound * 100)}% · safety ${Math.round(item.safetyBound * 100)}%`} status={item.status} />)}</div><Button className="mt-4" onClick={() => confirmation.mutate()}><Play className="h-4 w-4" /> Start confirmation</Button></Card>{data.repair?.searchCertification ? <SearchConfirmationEvidence search={data.repair.searchCertification} /> : null}</div>}
      {section === "report" && <Card><CardTitle>Research report</CardTitle>{data.reports.map((report: any) => <div key={report.id} className="mt-4 rounded-lg border border-neutral-950/10 p-4"><h3 className="font-medium">{report.title}</h3><p className="mt-2 text-sm text-neutral-600">{report.summary}</p></div>)}{data.repair?.searchCertification ? <SearchReportEvidence search={data.repair.searchCertification} /> : null}<ExportLinks links={[...(data.exportLinks || []), ...(data.repair?.runtimeExportLinks || []), ...(data.repair?.searchCertification?.exportLinks || []), ...(data.repair?.searchCertification?.fullConfirmation?.exportLinks || [])]} /></Card>}
    </Page>
  );
}

function Certificates() {
  const certificates = useQuery({ queryKey: ["certificates"], queryFn: () => api<any>("/certificates") });
  return <CollectionPage title="Certificates" items={certificates.data?.certificates || []} primary="scope" secondary="status" />;
}

function Reports() {
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api<any>("/reports") });
  return <CollectionPage title="Reports" items={reports.data?.reports || []} primary="title" secondary="summary" />;
}

function Integrations() {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: () => api<any>("/integrations") });
  return <CollectionPage title="Integrations" items={integrations.data?.integrations || []} primary="name" secondary="status" />;
}

function Team() {
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<any>("/team") });
  return <CollectionPage title="Team" items={team.data?.members?.map((m: any) => ({ ...m, name: m.user.name, status: m.role })) || []} primary="name" secondary="status" />;
}

function AuditLogs() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<any>("/audit-logs") });
  return <CollectionPage title="Audit logs" items={logs.data?.logs || []} primary="action" secondary="targetType" />;
}

function Settings({ page }: { page: AppPage }) {
  const copy: Record<string, [string, string[]]> = {
    "settings-profile": ["Profile", ["Name, email and email verification status.", "Profile editing is coming soon."]],
    "settings-security": ["Security", ["Active sessions can be revoked through the API.", "Use strong passwords and HTTP-only cookies."]],
    "settings-organization": ["Organization", ["Role policies, confirmation rules and audit retention.", "Organization editing is restricted to owners/admins."]],
    billing: ["Billing", ["No payment integration is enabled.", "Scan, Repair and Enterprise packaging are visible for planning."]]
  };
  const [title, items] = copy[page] || copy.billing;
  return <CollectionPage title={title} items={items.map((name) => ({ name, status: "configured" }))} primary="name" secondary="status" />;
}

function CollectionPage({ title, items, primary, secondary }: { title: string; items: any[]; primary: string; secondary: string }) {
  return (
    <Page title={title}>
      <Card><div className="grid gap-3">{items.length ? items.map((item, index) => <Row key={item.id || index} title={item[primary]} meta={item[secondary]} status={item.status || item[secondary]} />) : <Empty title="No records yet" />}</div></Card>
    </Page>
  );
}

function ProjectForm({ title, form, onSubmit, pending }: { title: string; form: any; onSubmit: (values: any) => void; pending: boolean }) {
  return (
    <Page title={title}>
      <Card><form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}><Field label="Project name"><Input {...form.register("name")} /></Field><Field label="Mode"><select className="h-10 rounded-md border border-neutral-950/20 bg-white px-3 text-sm text-neutral-950" {...form.register("mode")}><option value="scan">Scan</option><option value="repair">Repair</option></select></Field><Field label="Repository URL"><Input {...form.register("repositoryUrl")} placeholder="https://github.com/example/repo" /></Field><Button disabled={pending}>Create project</Button></form></Card>
    </Page>
  );
}

function JourneyForm({ title, form, onSubmit, pending }: { title: string; form: any; onSubmit: (values: any) => void; pending: boolean }) {
  return (
    <Page title={title}>
      <Card><form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}><Field label="Name"><Input {...form.register("name")} /></Field><Field label="Instruction"><Textarea {...form.register("instruction")} /></Field><Field label="Start checkpoint"><Input {...form.register("startCheckpoint")} /></Field><Field label="Success predicates"><Textarea {...form.register("successPredicates")} placeholder="One predicate per line" /></Field><Field label="Safety invariants"><Textarea {...form.register("safetyInvariants")} placeholder="One invariant per line" /></Field><Button disabled={pending}>Save journey</Button></form></Card>
    </Page>
  );
}

function Page({ title, subtitle = "Evidence and actions.", action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-4xl font-black tracking-normal text-[var(--text-primary)]">{title}</h1><p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[var(--text-secondary)]">{subtitle}</p></div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: any; icon: LucideIcon }) {
  return <Card className="group min-h-36 overflow-hidden hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"><div className="flex items-center justify-between"><Icon className="h-5 w-5 text-[var(--accent)]" /><span className="h-2 w-2 rounded-full bg-[var(--accent)] opacity-45" /></div><div className="mono-meta mt-5 text-3xl font-black text-[var(--text-primary)]">{value ?? 0}</div><div className="mt-1 text-xs font-semibold uppercase text-[var(--text-tertiary)]">{label}</div></Card>;
}

function Row({ title, meta, status }: { title: string; meta?: string; status?: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_76%,transparent)] p-3"><div><div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>{meta ? <div className="mt-1 text-xs text-[var(--text-secondary)]">{meta}</div> : null}</div><Badge className={toneClass(status)}>{status || "recorded"}</Badge></div>;
}

function List({ items, to }: { items: any[]; to?: (item: any) => string }) {
  return <div className="mt-4 grid gap-2">{items.length ? items.map((item) => to ? <Link key={item.id} to={to(item)}><Row title={item.name} meta={item.instruction || item.status} status={item.status || item.mode} /></Link> : <Row key={item.id} title={item.name} meta={item.status || item.createdAt} status={item.status} />) : <Empty title="No records yet" />}</div>;
}

function RunList({ runs }: { runs: any[] }) {
  return <Card><CardTitle>Recent experiments</CardTitle><div className="mt-4 grid gap-3">{runs.length ? runs.map((run) => <Link key={run.id} to={`/app/experiments/${run.id}`}><Row title={run.experiment.name} meta={run.experiment.project.name} status={run.status} /></Link>) : <Empty title="No experiment runs yet" />}</div></Card>;
}

function SummaryMetrics({ metrics }: { metrics: any }) {
  const providerModels = compactFrequency(metrics.providerModelSnapshot);
  const failedPredicates = compactFrequency(metrics.firstFailedPredicateFrequency);
  const items = [
    ["Total runs", metrics.totalRuns],
    ["Compliant success", `${Math.round((metrics.compliantSuccessRate || 0) * 100)}%`],
    ["Violation rate", `${Math.round((metrics.violationRate || 0) * 100)}%`],
    ["Median steps", metrics.medianSteps],
    ["Median latency", `${metrics.medianLatencyMs || 0} ms`],
    ["Expected defect detection", `${Math.round((metrics.expectedDefectDetectionRate || 0) * 100)}%`],
    ["Provider/model snapshot", providerModels || "none"],
    ["First failed predicates", failedPredicates || "none"]
  ];
  return <Card><CardTitle>Pilot metrics</CardTitle><div className="mt-4 grid gap-3 md:grid-cols-3">{items.map(([label, value]) => <Row key={label} title={String(label)} meta={String(value ?? 0)} status="metric" />)}</div></Card>;
}

function RepairSummary({ repair }: { repair: any }) {
  const kpis = repair.kpis || {};
  const runtime = repair.runtimeKpis || {};
  const search = repair.searchCertification || {};
  const items = [
    ["Localized", kpis.localized_runs || repair.localizations?.length || 0],
    ["Generated patches", repair.patches?.length || 0],
    ["Validated", repair.validations?.filter((row: any) => row.accepted).length || 0],
    ["Runtime replay", `${runtime.patchedExecuted || 0}/${runtime.pairedRuntimeRows || 0} patched`],
    ["Regression", `${runtime.regressionRuns || 0} runs · ${Math.round((runtime.regressionPassRate || 0) * 100)}%`],
    ["Rollback", `${runtime.rollbackRuns || 0} patches · ${Math.round((runtime.rollbackPassRate || 0) * 100)}%`],
    ["Unresolved", runtime.unresolvedCases ?? kpis.unresolved_cases ?? repair.replay?.filter((row: any) => !row.patchedExecuted).length ?? 0],
    ["Search evaluated", search.progress?.evaluatedConfigurations ?? 0],
    ["Repeated search", search.progress?.repeatedSearchRuns ?? 0],
    ["Frozen sets", search.progress?.frozenCandidateSets ?? 0],
    ["Certificates", compactFrequency(search.progress?.certificateStatus) || "none"],
    ["Runtime report", repair.runtimeReportPath || repair.reportPath || "not generated"]
  ];
  return <Card><CardTitle>Repair pilot</CardTitle><div className="mt-4 grid gap-3 md:grid-cols-3">{items.map(([label, value]) => <Row key={label} title={String(label)} meta={String(value ?? 0)} status="repair" />)}</div></Card>;
}

function SearchConfirmationEvidence({ search }: { search: any }) {
  const sets = search.candidateSets || [];
  const bounds = search.confidenceHistory || [];
  const full = search.fullConfirmation || {};
  return (
    <div className="grid gap-4">
      {full.summary?.length ? (
        <Card>
          <CardTitle>Full independent confirmation</CardTitle>
          <div className="mt-4 grid gap-3">
            {full.summary.map((row: any) => <Row key={`full-${row.replica}`} title={`${row.replica} ${row.status}`} meta={`runs ${row.validObservations}/${row.plannedObservations} · seeds ${row.completedCandidateSeedRuns}/${row.plannedCandidateSeedRuns} · remaining ${row.remainingCandidateSeedRuns}`} status={row.status} />)}
          </div>
        </Card>
      ) : null}
      <Card>
        <CardTitle>Frozen candidate sets</CardTitle>
        <div className="mt-4 grid gap-3">
          {sets.length ? sets.map((set: any) => <Row key={set.candidateSetHash} title={`${set.replica} · ${set.candidates?.length || 0} candidates`} meta={`${set.candidateSetHash} · frozen ${set.frozenAt}`} status="frozen" />) : <Empty title="No frozen candidate set recorded" />}
        </div>
      </Card>
      <Card>
        <CardTitle>Confidence bounds</CardTitle>
        <div className="mt-4 grid gap-3">
          {(full.candidateBounds || []).slice(0, 12).map((row: any) => <Row key={`full-bound-${row.replica}-${row.configuration_id}`} title={`${row.replica} · ${row.configuration_id}`} meta={`success [${Number(row.compliant_success_lower).toFixed(3)}, ${Number(row.compliant_success_upper).toFixed(3)}] · safety [${Number(row.violation_lower_max).toFixed(3)}, ${Number(row.violation_upper_max).toFixed(3)}]`} status={row.certified_safe === "true" || row.certified_safe === true ? "certified" : "bound"} />)}
          {bounds.length ? bounds.slice(-12).map((state: any) => <Row key={`${state.streamId}-${state.n}`} title={`${state.configurationId} · ${state.metric}`} meta={`${state.journeyId} · [${Number(state.lower).toFixed(3)}, ${Number(state.upper).toFixed(3)}] · n ${state.n}`} status="bound" />) : <Empty title="No confidence sequence history recorded" />}
        </div>
      </Card>
    </div>
  );
}

function SearchPatchEvidence({ search }: { search: any }) {
  return (
    <Card>
      <CardTitle>Selected patch configurations</CardTitle>
      <div className="mt-4 grid gap-3">
        {(search.candidateSets || []).flatMap((set: any) => (set.candidates || []).slice(0, 5).map((candidate: any) => (
          <Row key={`${set.replica}-${candidate.configurationId}`} title={`${set.replica} · ${candidate.configurationId}`} meta={`${candidate.patchIds?.join(";") || "empty"} · cost ${candidate.engineeringMinutes}m · ${candidate.inclusionReason}`} status={candidate.feasible ? "feasible" : "rejected"} />
        )))}
        {search.candidateSets?.length ? null : <Empty title="No search candidate sets recorded" />}
      </div>
    </Card>
  );
}

function SearchReportEvidence({ search }: { search: any }) {
  const plan = search.confirmationBudgetPlan || {};
  const planRows = Object.entries(plan.plans || {});
  const full = search.fullConfirmation || {};
  return (
    <div className="mt-4 grid gap-3">
      {(search.objectiveAudit || []).filter((row: any) => row.safe === "true" || row.safe === true).slice(0, 6).map((row: any) => <Row key={`objective-${row.replica}-${row.configuration_id}`} title={`${row.replica} objective ${row.configuration_id}`} meta={`J ${row.final_j} · success ${row.minimum_compliant_success} · cost ${row.cost_penalty} · latency ${row.latency_penalty}`} status="objective" />)}
      {(search.strategyComparison || []).map((row: any) => <Row key={`strategy-${row.replica}-${row.strategy}-${row.budget}`} title={`${row.replica} ${row.strategy} budget ${row.budget}`} meta={`mean regret ${row.mean_global_regret} · median ${row.median_global_regret} · oracle best ${row.probability_finding_oracle_best} · unsafe ${row.unsafe_recommendation_rate}`} status="search" />)}
      {planRows.map(([replica, item]: [string, any]) => <Row key={`budget-plan-${replica}`} title={`${replica} confirmation budget`} meta={`selected seeds ${(item.selectedFreshSeeds || []).join(",")} · planner minimum ${item.minimumPracticalConfirmationSeeds} · width ${item.desiredIntervalWidth}`} status="budget" />)}
      {(full.stoppingGaps || []).map((row: any) => <Row key={`full-gap-${row.replica}`} title={`${row.replica} full confirmation gap`} meta={`gap ${row.stopping_gap || "open"} · ${row.status}`} status={row.status} />)}
      {(full.certificates || []).map((certificate: any) => <Row key={`full-certificate-${certificate.replica}`} title={`${certificate.replica} full ${certificate.status}`} meta={`${certificate.reason || certificate.selectedConfiguration || "candidate-set scoped"} · ${certificate.evidenceBundlePath || ""}`} status={certificate.status} />)}
      {(full.evidenceBundles || []).map((bundle: any) => <Row key={`bundle-${bundle.replica}`} title={`${bundle.replica} evidence bundle`} meta={bundle.path} status="bundle" />)}
      {(search.regretSummary || []).map((row: any) => <Row key={`regret-${row.replica}`} title={`${row.replica} regret`} meta={`true best ${row.true_best_safe_configuration} · selected ${row.search_selected_configuration} · regret ${row.global_simple_regret}`} status="regret" />)}
      {(search.candidateRecall || []).map((row: any) => <Row key={`recall-${row.replica}`} title={`${row.replica} candidate recall`} meta={`${row.candidate_recall} at epsilon ${row.epsilon}`} status="recall" />)}
      {(search.certificates || []).map((certificate: any) => <Row key={`certificate-${certificate.replica}`} title={`${certificate.replica} ${certificate.status}`} meta={certificate.reason || certificate.candidateSetHash} status={certificate.status} />)}
    </div>
  );
}

function RepairFailureEvidence({ repair }: { repair: any }) {
  const localizations = (repair.localizations || []).slice(0, 8);
  const cones = new Map((repair.cones || []).map((cone: any) => [`${cone.runId}:${cone.defectId}`, cone]));
  const runtimePredicates = (repair.runtimePredicates || []).slice(0, 8);
  const unresolved = repair.runtimeUnresolved || [];
  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle>Repair localization</CardTitle>
        <div className="mt-4 grid gap-3">
          {localizations.length ? localizations.map((item: any) => {
            const cone = cones.get(`${item.runId}:${item.defectId}`) as any;
            return <Row key={`${item.runId}-${item.defectId}`} title={item.firstViolatedPredicate} meta={`${item.journeyId} · ${item.failureCategory} · checkpoint ${item.lastVerifiedCheckpoint} · cone ${cone?.coneNodeCount || 0}/${cone?.fullGraphNodeCount || 0}`} status={cone?.rootCauseContained ? "contained" : "open"} />;
          }) : <Empty title="No repair localization evidence recorded" />}
        </div>
      </Card>
      <Card>
        <CardTitle>Runtime verifier predicates</CardTitle>
        <div className="mt-4 grid gap-3">
          {runtimePredicates.length ? runtimePredicates.map((item: any) => <Row key={`${item.patchId}-${item.journeyId}`} title={item.originalFirstFailedPredicate || item.journeyId} meta={`${item.patchId} · patched predicates ${(item.patchedPredicates || []).filter((predicate: any) => predicate.passed).length}/${(item.patchedPredicates || []).length} · ${item.patchedResultPath || ""}`} status="verified" />) : <Empty title="No runtime verifier predicates recorded" />}
          {unresolved.length ? unresolved.slice(0, 6).map((item: any) => <Row key={`${item.phase}-${item.patch_id}-${item.seed}`} title={item.reason} meta={`${item.replica} · ${item.journey_id} · seed ${item.seed}`} status="unresolved" />) : null}
        </div>
      </Card>
    </div>
  );
}

function RepairPatchEvidence({ repair }: { repair: any }) {
  const validations = new Map((repair.validations || []).map((row: any) => [row.patchId, row]));
  const runtimeValidations = new Map((repair.runtimeValidations || []).map((row: any) => [row.patch_id, row]));
  const runtimeRollbacks = new Map((repair.runtimeRollback || []).map((row: any) => [row.patch_id, row]));
  const regressionSummaries = new Map((repair.runtimeRegressionSummary || []).map((row: any) => [row.patch_id, row]));
  return (
    <Card>
      <CardTitle>Typed repair patches</CardTitle>
      <div className="mt-4 grid gap-4">
        {(repair.patches || []).slice(0, 12).map((patch: any) => {
          const validation = validations.get(patch.patchId) as any;
          const replay = (repair.replay || []).filter((row: any) => row.patchId === patch.patchId);
          const runtimeReplay = (repair.runtimeReplay || []).filter((row: any) => row.patchId === patch.patchId);
          const runtimeValidation = runtimeValidations.get(patch.patchId) as any;
          const runtimeRollback = runtimeRollbacks.get(patch.patchId) as any;
          const regression = regressionSummaries.get(patch.patchId) as any;
          return (
            <div key={patch.patchId} className="rounded-lg border border-neutral-950/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{patch.operator}</h3><p className="mt-1 text-xs text-neutral-600">{patch.patchId} · {patch.targetNodeId}</p></div><Badge>{runtimeValidation?.accepted === "true" || runtimeValidation?.accepted === true ? "runtime validated" : validation?.accepted ? "static validated" : "open"}</Badge></div>
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-neutral-950/10 bg-white p-3 text-xs text-neutral-800">{patch.sourceDiff}</pre>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <Row title="Validation gates" meta={`${validation?.schemaValidation || "n/a"} schema · ${validation?.astStaticAnalysis || "n/a"} AST · ${validation?.rollbackTest || "n/a"} rollback`} status={validation?.accepted ? "passed" : "open"} />
                <Row title="Paired replay" meta={`${replay.filter((row: any) => row.patchedExecuted).length}/${replay.length} patched executions`} status={replay.some((row: any) => row.patchedExecuted) ? "recorded" : "unresolved"} />
                <Row title="Runtime paired replay" meta={`${runtimeReplay.filter((row: any) => row.patchedCompliantSuccess).length}/${runtimeReplay.length} compliant successes`} status={runtimeReplay.every((row: any) => row.patchedCompliantSuccess) ? "passed" : "unresolved"} />
                <Row title="Runtime regression" meta={`${regression?.passed || 0}/${regression?.regression_runs || 0} unaffected journeys`} status={Number(regression?.failed || 0) === 0 ? "passed" : "failed"} />
                <Row title="Runtime rollback" meta={`${runtimeRollback?.rollback_passed || false} · clean ${runtimeRollback?.clean_success_restored || false} · defect ${runtimeRollback?.original_defect_failure_restored || false}`} status={runtimeRollback?.rollback_passed === "true" || runtimeRollback?.rollback_passed === true ? "passed" : "open"} />
              </div>
            </div>
          );
        })}
        {repair.patches?.length ? null : <Empty title="No typed repair patches recorded" />}
      </div>
    </Card>
  );
}

function compactFrequency(value: Record<string, number> | undefined) {
  if (!value) return "";
  return Object.entries(value).map(([key, count]) => `${key} ${count}`).join("; ");
}

function ExportLinks({ links }: { links: Array<{ file: string; label: string; url: string }> }) {
  if (!links.length) return <div className="mt-4"><Empty title="No export links for this run" /></div>;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {links.map((link) => (
        <a key={link.file} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-950/20 bg-white px-3 text-sm font-medium text-neutral-950 hover:bg-orange-50" href={apiHref(link.url)} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> {link.file}
        </a>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Label className="grid gap-2"><span>{label}</span>{children}</Label>;
}

function Empty({ title }: { title: string }) {
  return <div className="rounded-lg border border-dashed border-neutral-950/20 p-6 text-center text-sm text-neutral-600">{title}</div>;
}

function LoadingGrid() {
  return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
}

function useProject(projectId?: string) {
  return useQuery({ queryKey: ["project", projectId], queryFn: () => api<any>(`/projects/${projectId}`), enabled: Boolean(projectId) });
}

function splitLines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function parseDefects(value?: string) {
  if (!value) return {};
  return Object.fromEntries(value.split(",").map((item) => item.split("=")).filter(([key]) => key).map(([key, raw]) => [key.trim(), ["true", "1", "yes", "on"].includes((raw || "true").trim().toLowerCase())]));
}

function apiHref(path: string) {
  return `${API_BASE.replace(/\/api\/v1$/, "")}${path}`;
}

function toneClass(status?: string) {
  const tone = statusTone(status);
  return cn(
    tone === "success" && "border-emerald-600/25 bg-emerald-50 text-emerald-700",
    tone === "danger" && "border-red-600/25 bg-red-50 text-red-700",
    tone === "info" && "border-orange-500/30 bg-orange-50 text-orange-700"
  );
}
