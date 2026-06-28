// src/app/register/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Registration failed");
      }

      // Auto sign-in after registration
      await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--color-base)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <span className="text-2xl font-semibold tracking-tight text-white">
            Collab<span style={{ color: "var(--color-accent)" }}>doc</span>
          </span>
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-2)" }}>
            Create your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {["name", "email", "password"].map((field) => (
            <div key={field}>
              <label
                htmlFor={field}
                className="block text-sm font-medium mb-1.5 capitalize"
                style={{ color: "var(--color-text-2)" }}
              >
                {field === "name" ? "Full name" : field}
              </label>
              <input
                id={field}
                type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                required
                value={form[field as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
                placeholder={
                  field === "name" ? "Ada Lovelace" :
                  field === "email" ? "ada@example.com" : "Min. 8 characters"
                }
                minLength={field === "password" ? 8 : undefined}
                suppressHydrationWarning
              />
            </div>
          ))}

          {error && (
            <p className="text-sm px-3 py-2 rounded-md"
              style={{ background: "#2a1212", color: "var(--color-error)", border: "1px solid #4a1a1a" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "white" }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: "var(--color-text-3)" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--color-accent)" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
