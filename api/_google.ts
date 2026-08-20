import { supabaseAdmin } from "./_supabaseServer.js";

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

// --- Materials union type (Classroom API returns exactly one of these keys per item) ---

type GoogleDriveFileMaterial = {
  driveFile: {
    driveFile: {
      id: string;
      title: string;
      alternateLink: string;
      thumbnailUrl?: string;
    };
    shareMode?: string;
  };
};

type GoogleLinkMaterial = {
  link: {
    url: string;
    title?: string;
    thumbnailUrl?: string;
  };
};

type GoogleYouTubeMaterial = {
  youTubeVideo: {
    id: string;
    title: string;
    alternateLink: string;
    thumbnailUrl?: string;
  };
};

type GoogleFormMaterial = {
  form: {
    formUrl: string;
    responseUrl?: string;
    title?: string;
    thumbnailUrl?: string;
  };
};

export type GoogleMaterial =
  | GoogleDriveFileMaterial
  | GoogleLinkMaterial
  | GoogleYouTubeMaterial
  | GoogleFormMaterial;

type GoogleCourseWork = {
  id: string;
  title: string;
  description?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  workType?: string;
  state?: string;
  alternateLink?: string;
  materials?: GoogleMaterial[];
  maxPoints?: number;
  creationTime?: string;
  updateTime?: string;
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
  // No `fields=` filter is passed, so Classroom already returns the full
  // resource — materials, maxPoints, creationTime, updateTime included.
  const data = await classroomFetch(`/courses/${courseId}/courseWork`, accessToken);
  return data.courseWork ?? [];
}

// --- Announcements ---

type GoogleAnnouncement = {
  id: string;
  text: string;
  state?: string;
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
};

export async function fetchAnnouncements(
  courseId: string,
  accessToken: string
): Promise<GoogleAnnouncement[]> {
  const data = await classroomFetch(
    `/courses/${courseId}/announcements?orderBy=updateTime desc`,
    accessToken
  );
  return data.announcements ?? [];
}

// Fetches full detail for a single task — used for on-demand "explain this
// assignment" lookups from the assistant chat (Phase 3), so we don't have to
// wait for a full sync to get the latest description/materials for one item.
export async function fetchCourseWorkDetail(
  courseId: string,
  courseWorkId: string,
  accessToken: string
): Promise<GoogleCourseWork> {
  return classroomFetch(`/courses/${courseId}/courseWork/${courseWorkId}`, accessToken);
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

// --- Append this to the bottom of api/_google.ts ---
// Pairs with fetchCourseWork/fetchCourseWorkDetail above, but POSTs a new
// courseWork item instead of reading. Used by api/classroom/create-task.ts,
// which only ever calls this after the user has explicitly confirmed.

export async function createCourseWork(
  courseId: string,
  accessToken: string,
  courseWork: {
    title: string;
    description?: string;
    workType?: string;
    state?: string;
    dueDate?: { year: number; month: number; day: number };
    dueTime?: { hours?: number; minutes?: number };
  }
): Promise<{ id: string; alternateLink: string }> {
  const res = await fetch(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(courseWork),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Classroom API error (${res.status}): ${body}`);
  }
  return res.json();
}

// --- Student submissions: write path (Phase 7 — file/photo turn-in) ---
//
// Requires the classroom.coursework.me scope (write, not just readonly) and
// the drive.file scope for uploads. Both need a fresh OAuth consent — see
// Login.tsx for where scopes are requested.

type GoogleStudentSubmission = {
  id: string;
  state: string;
  alternateLink?: string;
};

export async function fetchStudentSubmission(
  courseId: string,
  courseWorkId: string,
  accessToken: string
): Promise<GoogleStudentSubmission | null> {
  const data = await classroomFetch(
    `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?userId=me`,
    accessToken
  );
  return data.studentSubmissions?.[0] ?? null;
}

// Uploads a file to the student's Drive using the drive.file scope — the app
// can only ever see files it creates itself, never the rest of the user's
// Drive. This is intentionally the least-privileged scope that still works.
export async function uploadFileToDrive(
  accessToken: string,
  fileName: string,
  mimeType: string,
  base64Data: string
): Promise<{ id: string }> {
  const boundary = "atlas-upload-boundary";
  const metadata = JSON.stringify({ name: fileName });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Data}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

export async function attachDriveFileToSubmission(
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  driveFileId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}:modifyAttachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addAttachments: [{ driveFile: { id: driveFileId } }],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Attach failed (${res.status}): ${body}`);
  }
}

export async function turnInSubmission(
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}:turnIn`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Turn-in failed (${res.status}): ${body}`);
  }
}

// Turns plain typed text into a real Google Doc, using Drive's on-upload
// conversion (source text/plain -> target application/vnd.google-apps.document).
// This is how a "text answer" becomes something Classroom can attach to a
// submission, since ASSIGNMENT-type work only accepts file/link/video
// attachments — there's no bare-text submission field to write to directly.
export async function createGoogleDocFromText(
  accessToken: string,
  title: string,
  text: string
): Promise<{ id: string }> {
  const boundary = "atlas-doc-boundary";
  const metadata = JSON.stringify({
    name: title,
    mimeType: "application/vnd.google-apps.document",
  });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${text}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Doc creation failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Lets the student pull a submission back out of "turned in" state — the
// safety valve behind the confirm-before-permanent UI flow.
export async function reclaimSubmission(
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}:reclaim`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reclaim failed (${res.status}): ${body}`);
  }
}