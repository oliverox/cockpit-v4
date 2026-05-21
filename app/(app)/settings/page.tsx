import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";

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
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        Settings
      </h1>
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
    </div>
  );
}
