"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GenericTaskRenderer } from "@/components/tasks/generic-task-renderer";
import { getTaskTypeDef } from "@/modules/registry";

/**
 * Generic task detail page.
 *
 * Looks up the task type in the module registry. If the type declares a
 * custom renderer (e.g. accounting.bank_rec → the 4-step wizard), it's
 * rendered here. Otherwise we fall back to `GenericTaskRenderer`, which
 * handles the four core.* task types in Phase 1.3.
 */
export default function CustomerTaskDetailPage() {
  const params = useParams<{ id: string; taskId: string }>();
  const customerId = params.id as Id<"customers">;
  const taskId = params.taskId as Id<"tasks">;

  const task = useQuery(api.tasks.get, { taskId });

  if (task === undefined) {
    return <div className="p-8 text-sm text-ink-3">Loading…</div>;
  }

  if (task === null) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-ink-3">
        Task not found.
      </div>
    );
  }

  // Renderer dispatch
  const typeDef = getTaskTypeDef(task.type);
  const CustomRenderer = typeDef?.renderer;

  if (CustomRenderer) {
    return <CustomRenderer task={task} taskId={task._id} />;
  }

  return <GenericTaskRenderer task={task} customerId={customerId} />;
}
