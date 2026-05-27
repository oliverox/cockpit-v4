"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { NewEventDialog } from "@/components/calendar/new-event-dialog";
import {
  CalendarView,
  useCalendarMode,
} from "@/components/calendar/calendar-view";
import { TaskPanel } from "@/components/calendar/task-panel";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

/**
 * Workspace-wide calendar — every customer's events + tasks-with-dueDate,
 * paired with a panel of all open tasks across customers. Replaces the
 * old `/inbox` route as the "what's on across the firm" surface.
 */
export default function WorkspaceCalendarPage() {
  const items = useQuery(api.calendar.upcoming, { days: 120 });

  const [mode, setMode] = useCalendarMode("month");
  const [cursor, setCursor] = useState<number>(() => Date.now());
  const [newEventOpen, setNewEventOpen] = useState(false);

  return (
    <PageShell>
      <PageHeader eyebrow="Workspace" title="Calendar" />

      <div className="grid h-[calc(100vh-12rem)] min-h-[640px] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <CalendarView
            items={items}
            mode={mode}
            onModeChange={setMode}
            cursor={cursor}
            onCursorChange={setCursor}
            onNewEvent={() => setNewEventOpen(true)}
          />
        </div>
        <TaskPanel scope="workspace" />
      </div>

      <NewEventDialog open={newEventOpen} onOpenChange={setNewEventOpen} />
    </PageShell>
  );
}
