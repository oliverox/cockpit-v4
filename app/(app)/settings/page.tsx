import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

const sections = [
  {
    href: "/settings/team",
    label: "Team",
    description: "Members, roles, and customer scopes.",
    icon: Users,
  },
];

export default function SettingsPage() {
  return (
    <PageShell size="3xl" className="space-y-6">
      <PageHeader title="Settings" className="mb-0" />
      <nav className="overflow-hidden rounded-lg border border-line bg-card">
        <ul className="divide-y divide-line">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-card-tint"
                >
                  <Icon className="h-4 w-4 text-ink-3" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">
                      {s.label}
                    </div>
                    <div className="text-xs text-ink-3">{s.description}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </PageShell>
  );
}
