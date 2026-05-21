import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { PlaneTakeoff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/customers");

  return (
    <main className="min-h-screen px-8 py-20">
      <div className="mx-auto max-w-2xl space-y-10">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-fmu-navy">
            <PlaneTakeoff className="h-5 w-5" />
            <span className="eyebrow !text-ink-3">Cockpit</span>
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-fmu-navy">
            Cockpit v4
          </h1>
          <p className="text-lg text-ink-2 leading-relaxed max-w-xl">
            A multi-industry operations platform — CRM, documents, tasks, chat,
            calendar, and an AI co-pilot — for accountants, notaries, agencies,
            and beyond.
          </p>
        </header>

        <div className="rounded-xl border border-line bg-card p-8 space-y-4">
          <div>
            <div className="eyebrow">Invite-only preview</div>
            <p className="mt-2 text-ink-2 text-sm">
              Sign in or create an account to continue.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button variant="outline">Sign up</Button>
            </SignUpButton>
          </div>
        </div>
      </div>
    </main>
  );
}
