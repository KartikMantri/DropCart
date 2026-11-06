"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({
  next,
  demoEmail,
  demoPassword,
}: {
  next: string;
  demoEmail: string;
  demoPassword: string;
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {
    error: null,
    email: "",
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="nb-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className="nb-input"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="nb-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="nb-input"
        />
      </div>

      {state.error && (
        <p role="alert" className="border-[3px] border-ink bg-red px-3 py-2 font-bold">
          {state.error}
        </p>
      )}

      <button type="submit" className="nb-btn w-full text-lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <button
        type="button"
        className="nb-btn nb-btn-white w-full"
        disabled={pending}
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          (form.elements.namedItem("email") as HTMLInputElement).value = demoEmail;
          (form.elements.namedItem("password") as HTMLInputElement).value = demoPassword;
          form.requestSubmit();
        }}
      >
        Use demo account
      </button>
    </form>
  );
}
