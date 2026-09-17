import { ArrowRight, BadgeCheck, Bot, CheckCircle2, FileText, GitBranch, LockKeyhole, Radar, ScanSearch, ShieldCheck, SlidersHorizontal, TerminalSquare, Wrench, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";

type PublicPage =
  | "home"
  | "platform"
  | "how"
  | "research"
  | "pricing"
  | "docs"
  | "blog"
  | "blog-detail"
  | "contact"
  | "security"
  | "privacy"
  | "terms"
  | "404";

export default function PublicPages({ page }: { page: PublicPage }) {
  if (page === "home") return <Home />;
  if (page === "platform") return <Platform />;
  if (page === "how") return <HowItWorks />;
  if (page === "research") return <Research />;
  if (page === "pricing") return <Pricing />;
  if (page === "docs") return <Docs />;
  if (page === "blog") return <Blog />;
  if (page === "blog-detail") return <BlogDetail />;
  if (page === "contact") return <TextPage title="Contact" intro="Security reviews, pilots and enterprise runners." items={["Security review", "Research pilot", "Enterprise runner"]} />;
  if (page === "security") return <TextPage title="Security" intro="Local scope. Redacted secrets. Explicit approvals." items={["HTTP-only cookies", "Role access", "Audit logs", "No production effects"]} />;
  if (page === "privacy") return <TextPage title="Privacy" intro="Only workspace data and evidence." items={["No hidden reasoning", "Secrets redacted", "Local mail outbox"]} />;
  if (page === "terms") return <TextPage title="Terms" intro="Use PATCHWORK only on authorized systems." items={["Local or staging only", "No real payments", "Review repairs first"]} />;
  return <NotFound />;
}

function Home() {
  return (
    <>
      <WebsiteDesign />
      <ProjectArchitecture />
      <FinalDesign />
    </>
  );
}

function WebsiteDesign() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-[var(--border-subtle)]">
        <div className="fine-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-18">
          <div>
            <Badge className="w-fit border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-subtle)] text-[var(--accent)]">Agent safety</Badge>
            <h1 className="text-balance mt-6 max-w-4xl text-6xl font-black leading-[0.88] tracking-normal text-[var(--text-primary)] sm:text-8xl">PATCHWORK</h1>
            <p className="mt-6 max-w-2xl text-2xl font-semibold leading-8 text-[var(--text-primary)]">Test agents. Repair flows. Confirm evidence.</p>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--text-secondary)]">Scan journeys, find failures, review repairs and certify proof.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup"><Button>Start workspace <ArrowRight className="h-4 w-4" /></Button></Link>
              <Link to="/platform"><Button variant="secondary">Explore</Button></Link>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
              {[["6", "services"], ["0", "prod effects"], ["100%", "scoped"]].map(([value, label]) => (
                <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] p-3">
                  <div className="mono-meta text-2xl font-black text-[var(--text-primary)]">{value}</div>
                  <div className="mt-1 text-xs font-semibold uppercase text-[var(--text-tertiary)]">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <HeroConsole />
        </div>
      </section>
      <CredibilityStrip />
    </>
  );
}

function ProjectArchitecture() {
  return (
    <>
      <Workflow />
      <Section title="Core flow" intro="Clean steps. Clear evidence." variant="split">
        <Feature icon={ScanSearch} title="Readiness" text="URLs, API health, resets, journeys." />
        <Feature icon={SlidersHorizontal} title="Contracts" text="Success, safety, scope, budget." />
        <Feature icon={Wrench} title="Repair review" text="Diffs, gates, cost, rollback." />
      </Section>
      <Section title="Agent views" intro="Separate signals. One review.">
        {["Scripted baseline", "Accessibility Agent A", "Accessibility Agent B", "Screenshot Agent", "OpenAPI Tool Agent"].map((item) => (
          <Feature key={item} icon={Bot} title={item} text="Configured safely." />
        ))}
      </Section>
      <Pipeline />
    </>
  );
}

function FinalDesign() {
  return (
    <>
      <Section title="Safety gates" intro="No proof. No certificate.">
        <Feature icon={ShieldCheck} title="Abstain" text="Insufficient evidence stops certification." />
        <Feature icon={LockKeyhole} title="Redact" text="Tokens, cookies and keys stay hidden." />
        <Feature icon={BadgeCheck} title="Scope" text="Journey, agent, environment." />
      </Section>
      <Plans />
      <Section title="Evidence" intro="Scoped. Traceable. Honest.">
        <Feature icon={Radar} title="Replicas" text="Repeatable tests." />
        <Feature icon={GitBranch} title="Before / after" text="Baseline, candidate, confirmation." />
        <Feature icon={FileText} title="Limits" text="No unsupported claims." />
      </Section>
      <CTA />
    </>
  );
}

function HeroConsole() {
  const nodes = ["Agent run", "Contract check", "Violation", "Repair diff", "Confirmation"];
  return (
    <div className="surface-float relative rounded-xl p-3">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inverse)] p-4 text-[var(--text-inverse)] shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-white/64">
            <TerminalSquare className="h-4 w-4 text-[var(--accent)]" />
            Evidence run
          </div>
          <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-200">verified</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_0.9fr]">
          <div className="grid gap-2">
            {nodes.map((node, index) => (
              <div key={node} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-md border border-white/10 bg-white/[0.045] px-3 py-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${index === 2 ? "bg-[var(--accent)] text-white" : "bg-white/10 text-white/75"}`}>{index + 1}</span>
                <span className="text-sm font-semibold">{node}</span>
                <span className="mono-meta text-[11px] text-white/48">{index === 2 ? "blocked" : "pass"}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-white/10 bg-black/22 p-3">
            <div className="text-xs font-semibold uppercase text-white/50">Repair candidate</div>
            <div className="mono-meta mt-3 space-y-2 text-xs leading-5">
              <div className="text-red-200">- submitOrder(orderId)</div>
              <div className="text-emerald-200">+ submitOrder(idempotencyKey)</div>
              <div className="text-white/52">gate: replay</div>
              <div className="text-white/52">scope: ShopTwin checkout</div>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10">
              <div className="h-2 w-[78%] rounded-full bg-[var(--accent)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredibilityStrip() {
  return (
    <section className="border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_56%,transparent)]">
      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 text-sm font-semibold text-[var(--text-secondary)] sm:px-6 md:grid-cols-4">
        {["Local replicas", "Audit evidence", "Safety gates", "No prod effects"].map((item) => <div key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[var(--accent)]" />{item}</div>)}
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    ["01", "Scan", "Check surfaces and health."],
    ["02", "Test", "Run agents against journeys."],
    ["03", "Localize", "Find the failure point."],
    ["04", "Repair", "Review candidate diffs."],
    ["05", "Confirm", "Replay and certify."]
  ];
  return (
    <section className="border-b border-[var(--border-subtle)] bg-[var(--canvas-raised)]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Header title="Project architecture" intro="Start with scan. End with proof." />
        <div className="relative grid gap-3 lg:grid-cols-5">
          <div className="absolute left-0 right-0 top-9 hidden h-px bg-[var(--border-strong)] lg:block" />
          {steps.map(([number, title, text]) => (
            <div key={title} className="surface-float relative rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="mono-meta text-xs font-black text-[var(--accent)]">{number}</span>
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_5px_var(--accent-quiet)]" />
              </div>
              <h3 className="mt-8 text-xl font-black text-[var(--text-primary)]">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Platform() {
  return (
    <PageShell title="Central platform" intro="Projects, journeys, agents, runs and proof.">
      {["Scan", "Journey testing", "Failure localization", "Repair generation", "Validation", "Confirmation", "Monitoring", "Enterprise runner"].map((item) => (
        <Feature key={item} icon={CheckCircle2} title={item} text="Configured with audit state." />
      ))}
    </PageShell>
  );
}

function HowItWorks() {
  return (
    <PageShell title="How it works" intro="Connect. Test. Repair. Confirm.">
      {["Connect", "Define journeys", "Run agents", "Diagnose", "Repair", "Verify", "Deploy or abstain"].map((item, index) => (
        <Feature key={item} icon={ArrowRight} title={`${index + 1}. ${item}`} text="State, evidence and approval." />
      ))}
    </PageShell>
  );
}

function Research() {
  return (
    <PageShell title="Research" intro="Search is separate from certification.">
      {["Search versus certification", "Controlled replicas", "Safety contracts", "Evidence and limitations", "No unsupported empirical claims"].map((item) => (
        <Feature key={item} icon={FileText} title={item} text="Scope and proof stay visible." />
      ))}
    </PageShell>
  );
}

function Pricing() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <Header title="Plans" intro="Packaging only. Payments disabled." />
      <div className="mb-6 inline-flex rounded-lg border border-neutral-950/10 bg-white p-1 text-sm">
        <span className="rounded-md bg-orange-500 px-3 py-1 text-neutral-950">Monthly</span>
        <span className="px-3 py-1 text-neutral-600">Yearly</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {["Scan", "Repair", "Enterprise"].map((plan) => (
          <Card key={plan}>
            <CardTitle>{plan}</CardTitle>
            <p className="mt-3 text-sm text-neutral-600">{plan === "Scan" ? "Readiness and journey evidence." : plan === "Repair" ? "Repair review and confirmation." : "Runner and policy controls."}</p>
            <Button className="mt-5 w-full" disabled={plan === "Enterprise"}>{plan === "Enterprise" ? "Contact required" : "Start trial"}</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Docs() {
  return <TextPage title="Docs" intro="Start with a project, journey and agent." items={["Getting started", "GitHub integration", "Staging", "Agents", "Journeys", "API", "Certificates"]} />;
}

function Blog() {
  return <PageShell title="Notes" intro="Testing, repair and verification."><Feature icon={FileText} title="Certification scope" text="Environment, journey, confirmation." /><Feature icon={FileText} title="Signals" text="Pixels, semantics and tools." /></PageShell>;
}

function BlogDetail() {
  const params = useParams();
  return <TextPage title={params.slug?.replaceAll("-", " ") || "Research note"} intro="Reproducible evidence only." items={["Problem", "Setup", "Boundary", "Takeaway"]} />;
}

function Plans() {
  return (
    <Section title="Plans" intro="Access by workflow.">
      {["Scan", "Repair", "Enterprise"].map((item) => <Feature key={item} icon={BadgeCheck} title={item} text="Clear access. Clear review." />)}
    </Section>
  );
}

function Pipeline() {
  return (
    <section className="border-y border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_62%,transparent)]">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <Header title="Repair pipeline" intro="Find, patch, validate, confirm." />
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.9fr_0.9fr]">
          <Card className="md:row-span-2">
            <CardTitle>Failure cone</CardTitle>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Predicates, checkpoints, components.</p>
            <div className="mt-6 grid gap-2">
              {["Predicate violated", "Checkpoint isolated", "Component evidence"].map((item) => <Rowlet key={item} text={item} />)}
            </div>
          </Card>
          {["Candidate repair", "Static validation", "Runtime replay", "Independent confirmation"].map((item) => <Card key={item} className="min-h-36"><CardTitle>{item}</CardTitle><p className="mt-3 text-sm text-[var(--text-secondary)]">Status, source, review.</p></Card>)}
        </div>
      </div>
    </section>
  );
}

function Rowlet({ text }: { text: string }) {
  return <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--canvas-raised)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]">{text}</div>;
}

function CTA() {
  return (
    <section className="px-4 py-14 sm:px-6">
      <div className="surface-float mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 rounded-xl p-8 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Start a controlled workspace.</h2>
          <p className="mt-2 text-[var(--text-secondary)]">Staging data. Safety gates. Evidence.</p>
        </div>
        <Link to="/signup"><Button>Start workspace</Button></Link>
      </div>
    </section>
  );
}

function PageShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <Header title={title} intro={intro} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Section({ title, intro, children, variant = "default" }: { title: string; intro: string; children: ReactNode; variant?: "default" | "split" }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <Header title={title} intro={intro} />
      <div className={`grid gap-4 ${variant === "split" ? "md:grid-cols-[1.2fr_0.9fr_0.9fr]" : "md:grid-cols-3"}`}>{children}</div>
    </section>
  );
}

function Header({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <h2 className="text-balance text-4xl font-black text-[var(--text-primary)]">{title}</h2>
      <p className="mt-3 text-base font-medium leading-7 text-[var(--text-secondary)]">{intro}</p>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <Card className="group hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] hover:shadow-[var(--shadow-float)]">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--accent-subtle)] text-[var(--accent)]">
        <Icon className="h-5 w-5" />
      </span>
      <CardTitle className="mt-4">{title}</CardTitle>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{text}</p>
    </Card>
  );
}

function TextPage({ title, intro, items }: { title: string; intro: string; items: string[] }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <Header title={title} intro={intro} />
      <Card>
        <div className="grid gap-3">
          {items.map((item) => <div key={item} className="rounded-lg border border-neutral-950/10 bg-white/75 p-3 text-sm text-neutral-800">{item}</div>)}
        </div>
      </Card>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
      <h1 className="text-4xl font-semibold">Page not found</h1>
      <p className="mt-3 text-neutral-600">The requested PATCHWORK page does not exist.</p>
      <Link to="/"><Button className="mt-6">Return home</Button></Link>
    </div>
  );
}
