import { supabaseAdmin } from "./_supabaseServer";

export async function getValidAccessToken(userId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("google_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !row) {
    throw new Error(
      "No Google tokens on file for this user — sign in again to reconnect Classroom."
    );
  }

  const expiresAt = new Date(row.expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 60_000;

  if (!isExpiringSoon) {
    return row.access_token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID as string;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET as string;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to refresh Google token: ${body}`);
  }

  const refreshed = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const newExpiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000
  ).toISOString();

  await admin
    .from("google_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return refreshed.access_token;
}

type GoogleCourse = {
  id: string;
  name: string;
  section?: string;
  room?: string;
  courseState?: string;
  alternateLink?: string;
};

type GoogleCourseWork = {
  id: string;
  title: string;
  description?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  workType?: string;
  state?: string;
  alternateLink?: string;
};

async function classroomFetch(path: string, accessToken: string) {
  const res = await fetch(`https://classroom.googleapis.com/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Classroom API error (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchCourses(accessToken: string): Promise<GoogleCourse[]> {
  const data = await classroomFetch("/courses?courseStates=ACTIVE", accessToken);
  return data.courses ?? [];
}

export async function fetchCourseWork(
  courseId: string,
  accessToken: string
): Promise<GoogleCourseWork[]> {
  const data = await classroomFetch(`/courses/${courseId}/courseWork`, accessToken);
  return data.courseWork ?? [];
}

export async function fetchSubmissionState(
  courseId: string,
  courseWorkId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const data = await classroomFetch(
      `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?userId=me`,
      accessToken
    );
    const submission = data.studentSubmissions?.[0];
    return submission?.state ?? null;
  } catch {
    return null;
  }
}

export function combineDueDateTime(
  dueDate?: GoogleCourseWork["dueDate"],
  dueTime?: GoogleCourseWork["dueTime"]
): string | null {
  if (!dueDate) return null;
  const d = new Date(
    Date.UTC(
      dueDate.year,
      dueDate.month - 1,
      dueDate.day,
      dueTime?.hours ?? 23,
      dueTime?.minutes ?? 59
    )
  );
  return d.toISOString();
}