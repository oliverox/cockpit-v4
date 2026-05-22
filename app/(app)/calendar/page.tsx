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
    <div className="w-full px-8 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Calendar
          </h1>
        </div>
      </header>

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
    </div>
  );
}
