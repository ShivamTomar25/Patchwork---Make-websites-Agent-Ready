import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { api, ApiClientError } from "../api/client";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { useToast } from "../components/ui/toast";

type AuthPage = "login" | "signup" | "verify-email" | "forgot-password" | "reset-password";

const password = z
  .string()
  .min(10, "Use at least 10 characters.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[0-9]/, "Add a number.")
  .regex(/[^A-Za-z0-9]/, "Add a symbol.");

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  organizationName: z.string().min(2),
  password
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const emailSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(20), password });
const tokenSchema = z.object({ token: z.string().min(20) });

export default function AuthPages({ page }: { page: AuthPage }) {
  return (
    <div className="fine-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-neutral-700 hover:text-neutral-950">
          <ArrowLeft className="h-4 w-4" /> Back to PATCHWORK
        </Link>
        <Card>
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-neutral-950"><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <CardTitle>{titleFor(page)}</CardTitle>
              <p className="text-sm text-neutral-600">{subtitleFor(page)}</p>
            </div>
          </div>
          {page === "login" && <Login />}
          {page === "signup" && <Signup />}
          {page === "forgot-password" && <ForgotPassword />}
          {page === "reset-password" && <ResetPassword />}
          {page === "verify-email" && <VerifyEmail />}
        </Card>
      </div>
    </div>
  );
}

function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: import.meta.env.DEV ? { email: "demo@patchwork.local", password: "Patchwork123!" } : { email: "", password: "" }
  });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof loginSchema>) => api("/auth/login", { method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.show("Signed in");
      navigate("/app");
    }
  });
  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Field label="Email" error={form.formState.errors.email?.message}><Input {...form.register("email")} type="email" autoComplete="email" /></Field>
      <Field label="Password" error={form.formState.errors.password?.message}><Input {...form.register("password")} type="password" autoComplete="current-password" /></Field>
      <Error error={mutation.error} />
      <Button disabled={mutation.isPending}>{mutation.isPending ? "Signing in..." : "Log in"}</Button>
      <div className="flex justify-between text-sm text-neutral-600">
        <Link to="/forgot-password" className="hover:text-neutral-950">Forgot password?</Link>
        <Link to="/signup" className="hover:text-neutral-950">Create account</Link>
      </div>
    </form>
  );
}

function Signup() {
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", name: "", organizationName: "", password: "" }
  });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof signupSchema>) => api("/auth/signup", { method: "POST", body }),
    onSuccess: () => {
      toast.show("Workspace created");
      navigate("/app");
    }
  });
  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Field label="Name" error={form.formState.errors.name?.message}><Input {...form.register("name")} autoComplete="name" /></Field>
      <Field label="Work email" error={form.formState.errors.email?.message}><Input {...form.register("email")} type="email" autoComplete="email" /></Field>
      <Field label="Organization" error={form.formState.errors.organizationName?.message}><Input {...form.register("organizationName")} /></Field>
      <Field label="Password" error={form.formState.errors.password?.message}><Input {...form.register("password")} type="password" autoComplete="new-password" /></Field>
      <Error error={mutation.error} />
      <Button disabled={mutation.isPending}>{mutation.isPending ? "Creating..." : "Create workspace"}</Button>
      <Link to="/login" className="text-sm text-neutral-600 hover:text-neutral-950">Already have an account?</Link>
    </form>
  );
}

function ForgotPassword() {
  const toast = useToast();
  const form = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof emailSchema>) => api<{ message: string }>("/auth/forgot-password", { method: "POST", body }),
    onSuccess: (data) => toast.show(data.message)
  });
  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Field label="Email" error={form.formState.errors.email?.message}><Input {...form.register("email")} type="email" /></Field>
      <Error error={mutation.error} />
      <Button disabled={mutation.isPending}>Send reset instructions</Button>
    </form>
  );
}

function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { token: params.get("token") || "", password: "" }
  });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof resetSchema>) => api("/auth/reset-password", { method: "POST", body }),
    onSuccess: () => {
      toast.show("Password reset");
      navigate("/login");
    }
  });
  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Field label="Reset token" error={form.formState.errors.token?.message}><Input {...form.register("token")} /></Field>
      <Field label="New password" error={form.formState.errors.password?.message}><Input {...form.register("password")} type="password" /></Field>
      <Error error={mutation.error} />
      <Button disabled={mutation.isPending}>Reset password</Button>
    </form>
  );
}

function VerifyEmail() {
  const [params] = useSearchParams();
  const toast = useToast();
  const form = useForm<z.infer<typeof tokenSchema>>({ resolver: zodResolver(tokenSchema), defaultValues: { token: params.get("token") || "" } });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof tokenSchema>) => api("/auth/verify-email", { method: "POST", body }),
    onSuccess: () => toast.show("Email verified")
  });
  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Field label="Verification token" error={form.formState.errors.token?.message}><Input {...form.register("token")} /></Field>
      <Error error={mutation.error} />
      <Button disabled={mutation.isPending}>Verify email</Button>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </Label>
  );
}

function Error({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiClientError ? error.message : "Request failed.";
  return <div className="rounded-lg border border-red-600/25 bg-red-50 p-3 text-sm font-medium text-red-700">{message}</div>;
}

function titleFor(page: AuthPage) {
  return page === "login" ? "Log in" : page === "signup" ? "Create workspace" : page === "forgot-password" ? "Reset access" : page === "reset-password" ? "Set new password" : "Verify email";
}

function subtitleFor(page: AuthPage) {
  return page === "login" ? (import.meta.env.DEV ? "Use the demo account or your workspace." : "Sign in with your workspace account.") : page === "signup" ? "A new organization is created with you as owner." : "Development mail is stored in the API outbox.";
}
