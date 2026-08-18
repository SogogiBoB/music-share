import { supabase } from "./supabaseClient.js";

const NICKNAME_KEY = "music-share:nickname";

export async function ensureIdentity() {
  const { data: { session } } = await supabase.auth.getSession();
  let uid;
  if (session?.user) {
    uid = session.user.id;
  } else {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    uid = data.user.id;
  }

  let nickname = localStorage.getItem(NICKNAME_KEY);
  if (!nickname) {
    nickname = await promptNickname();
    localStorage.setItem(NICKNAME_KEY, nickname);
  }

  await supabase.from("profiles").upsert({ uid, nickname });

  return { uid, nickname };
}

function promptNickname() {
  return new Promise((resolve) => {
    const modal = document.getElementById("nickname-modal");
    const input = document.getElementById("nickname-input");
    const button = document.getElementById("nickname-submit");
    modal.classList.remove("hidden");
    // { once: true } 를 쓰면 빈 값으로 한 번 누른 순간 유일한 제출 수단이 사라진다.
    // 성공 시 promise 가 이미 resolve 되고 모달도 감춰지므로 리스너를 남겨둬도 무해하다.
    button.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value) return;
      modal.classList.add("hidden");
      resolve(value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") button.click();
    });
  });
}
