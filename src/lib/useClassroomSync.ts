import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Course = {
  id: string;
  name: string;
  section: string | null;
};

// --- Materials union type (mirrors api/_google.ts — exactly one key set per item) ---

export type CourseworkMaterial =
  | {
      driveFile: {
        driveFile: {
          id: string;
          title: string;
          alternateLink: string;
          thumbnailUrl?: string;
        };
        shareMode?: string;
      };
    }
  | {
      link: {
        url: string;
        title?: string;
        thumbnailUrl?: string;
      };
    }
  | {
      youTubeVideo: {
        id: string;
        title: string;
        alternateLink: string;
        thumbnailUrl?: string;
      };
    }
  | {
      form: {
        formUrl: string;
        responseUrl?: string;
        title?: string;
        thumbnailUrl?: string;
      };
    };

export type CourseworkItem = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  work_type: string | null;
  alternate_link: string | null;
  submission_state: string | null;
  is_done: boolean;
  materials: CourseworkMaterial[] | null;
  max_points: number | null;
  creation_time: string | null;
  update_time: string | null;
};

export function useClassroomSync() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursework, setCoursework] = useState<CourseworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in.");

      const res = await fetch("/api/classroom/sync", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }

      const data = await res.json();
      setCourses(data.courses ?? []);
      setCoursework(data.coursework ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  return { courses, coursework, loading, error, refetch: sync };
}

// On-demand live lookup for a single task — hits /api/classroom/task instead
// of relying on the last full sync. Use this from the assistant chat when the
// user asks about one specific assignment.
export async function getTaskDetail(courseId: string, courseWorkId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const params = new URLSearchParams({ courseId, courseWorkId });
  const res = await fetch(`/api/classroom/task?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Task lookup failed (${res.status})`);
  }

  const data = await res.json();
  return data.task;
}