import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer.js";
import { getValidAccessToken, createCourseWork } from "../_google.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const user = await verifyUser(req);
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  const { courseId, title, description, dueDate } = (req.body ?? {}) as {
    courseId?: string;
    title?: string;
    description?: string;
    dueDate?: string | null;
  };

  if (!courseId || !title) {
    res.status(400).json({ error: "Missing courseId or title" });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(user.id);
    const dueDateObj = dueDate ? new Date(dueDate) : null;

    const created = await createCourseWork(courseId, accessToken, {
      title,
      description,
      workType: "ASSIGNMENT",
      state: "PUBLISHED",
      dueDate: dueDateObj
        ? {
            year: dueDateObj.getFullYear(),
            month: dueDateObj.getMonth() + 1,
            day: dueDateObj.getDate(),
          }
        : undefined,
    });

    res.status(200).json({ id: created.id, alternateLink: created.alternateLink });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Classroom API request failed",
    });
  }
}