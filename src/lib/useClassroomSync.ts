import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Course = {
  id: string;
  name: string;
  section: string | null;
};

export type CourseworkItem = {
  id: string;
  course_id: string;
  title: string;
  due_at: string | null;
  work_type: string | null;
  alternate_link: string | null;
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