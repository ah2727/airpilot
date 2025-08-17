// app/api/auth/login/route.ts
import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Forward to NestJS auth
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(err || { message: "Login failed" }, { status: res.status });
    }

    const data = await res.json(); // { access_token, user }
    const token = data?.access_token;
    if (!token) {
      return NextResponse.json({ message: "Missing token" }, { status: 500 });
    }

    const resp = NextResponse.json({ user: data.user, access_token: token });

    // Set httpOnly cookie so middleware can read it
    resp.cookies.set("access_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return resp;
  } catch (e) {
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 });
  }
}
