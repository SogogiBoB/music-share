import { supabase } from "./supabaseClient.js";

const NICKNAME_KEY = "music-share:nickname";

export function validateNickname(rawValue) {
  const value = rawValue.trim();
  return {
    value,
    message: value ? "" : "닉네임을 입력해 주세요.",
  };
}

export function setNicknameModalVisibility(modal, visible) {
  modal.classList.toggle("hidden", !visible);
}

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
  } else {
    setNicknameModalVisibility(document.getElementById("nickname-modal"), false);
  }

  await supabase.from("profiles").upsert({ uid, nickname });

  return { uid, nickname };
}

function promptNickname() {
  return new Promise((resolve) => {
    const modal = document.getElementById("nickname-modal");
    const input = document.getElementById("nickname-input");
    const button = document.getElementById("nickname-submit");
    const error = document.getElementById("nickname-error");
    setNicknameModalVisibility(modal, true);
    requestAnimationFrame(() => input.focus());
    // { once: true } 를 쓰면 빈 값으로 한 번 누른 순간 유일한 제출 수단이 사라진다.
    // 성공 시 promise 가 이미 resolve 되고 모달도 감춰지므로 리스너를 남겨둬도 무해하다.
    button.addEventListener("click", () => {
      const { value, message } = validateNickname(input.value);
      error.textContent = message;
      input.setAttribute("aria-invalid", String(Boolean(message)));
      if (message) {
        input.focus();
        return;
      }
      setNicknameModalVisibility(modal, false);
      resolve(value);
    });
    input.addEventListener("input", () => {
      if (error.textContent) {
        error.textContent = "";
        input.setAttribute("aria-invalid", "false");
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") button.click();
    });
  });
}
