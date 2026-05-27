"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GenericTaskRenderer } from "@/components/tasks/generic-task-renderer";
import { TaskChatEmbed } from "@/components/chat/task-chat-embed";
import { getTaskTypeDef } from "@/modules/registry";
import { LoadingState } from "@/components/states";

/**
 * Task detail page.
 *
 * Full-width canvas. Left column: the task renderer (custom from the module
 * manifest, or `GenericTaskRenderer` fallback). Right column: a discussion
 * embed showing only messages tagged with this task. Replies from the embed
 * auto-tag, so the conversation stays scoped without manual #-referencing.
 *
 * Custom renderers that already own the full-width canvas (e.g. multi-step
 * wizards) can declare `fullWidth: true` in their type def and they get
 * rendered without the chat embed alongside.
 */
export default function CustomerTaskDetailPage() {
  const params = useParams<{ id: string; taskId: string }>();
  const customerId = params.id as Id<"customers">;
  const taskId = params.taskId as Id<"tasks">;

  const task = useQuery(api.tasks.get, { taskId });

  if (task === undefined) {
    return <LoadingState className="w-full px-8 py-8" />;
  }

  if (task === null) {
    return (
      <div className="w-full px-8 py-8 text-sm text-ink-3">
        Task not found.
      </div>
    );
  }

  const typeDef = getTaskTypeDef(task.type);
  const CustomRenderer = typeDef?.renderer;

  // Custom renderers that want the whole canvas (wizards etc.) opt out.
  if (CustomRenderer && typeDef?.fullWidth) {
    return <CustomRenderer task={task} taskId={task._id} />;
  }

  return (
    <div className="w-full px-8 py-8">
      <div className="grid h-[calc(100vh-8rem)] min-h-[640px] gap-6 lg:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 overflow-y-auto">
          {CustomRenderer ? (
            <CustomRenderer task={task} taskId={task._id} />
          ) : (
            <GenericTaskRenderer task={task} customerId={customerId} />
          )}
        </div>
        <TaskChatEmbed customerId={customerId} taskId={task._id} />
      </div>
    </div>
  );
}
