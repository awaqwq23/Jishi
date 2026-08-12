import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import TodoApp from "./TodoApp";

export const metadata: Metadata = {
  title: "记时 · 待办",
  description: "把每一件重要的小事，安放在合适的时间。",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <TodoApp authenticatedUser={user} />;
}
