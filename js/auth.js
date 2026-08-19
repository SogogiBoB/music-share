import { supabase } from "./supabaseClient.js";
import { unlockAudio } from "./player.js?v=20260820-crt";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNickname(rawValue) {
  const value = rawValue.trim();
  return {
    value,
    message: value ? "" : "닉네임을 입력해 주세요.",
  };
}

export function validateEmail(rawValue) {
  const value = rawValue.trim();
  if (!value) return { value, message: "이메일을 입력해 주세요." };
  if (!EMAIL_RE.test(value)) return { value, message: "올바른 이메일 형식이 아니에요." };
  return { value, message: "" };
}

export function validatePassword(rawValue) {
  const value = rawValue;
  if (!value) return { value, message: "비밀번호를 입력해 주세요." };
  if (value.length < 6) return { value, message: "비밀번호는 6자 이상이어야 해요." };
  return { value, message: "" };
}

export function setNicknameModalVisibility(modal, visible) {
  modal.classList.toggle("hidden", !visible);
}

export async function ensureIdentity() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    const uid = session.user.id;
    const { data: profile } = await supabase.from("profiles").select().eq("uid", uid).single();
    setNicknameModalVisibility(document.getElementById("nickname-modal"), false);
    const identity = {
      uid,
      nickname: profile?.nickname ?? "게스트",
      isGuest: profile?.is_guest ?? false,
      fromPrompt: false,
    };
    // 게스트 세션은 is_guest 를 덮어쓰지 않도록 nickname 만 갱신한다.
    await supabase.from("profiles").upsert({ uid, nickname: identity.nickname });
    return identity;
  }
  const result = await promptAuth();
  return { isGuest: false, fromPrompt: true, ...result };
}

export async function signOut() {
  await supabase.auth.signOut();
}

function promptAuth() {
  return new Promise((resolve) => {
    const modal = document.getElementById("nickname-modal");
    const loginTab = document.getElementById("auth-tab-login");
    const signupTab = document.getElementById("auth-tab-signup");
    const guestTab = document.getElementById("auth-tab-guest");
    const loginPanel = document.getElementById("auth-panel-login");
    const signupPanel = document.getElementById("auth-panel-signup");
    const guestPanel = document.getElementById("auth-panel-guest");

    const loginEmail = document.getElementById("login-email-input");
    const loginPassword = document.getElementById("login-password-input");
    const loginButton = document.getElementById("login-submit");
    const loginError = document.getElementById("login-error");

    const signupEmail = document.getElementById("signup-email-input");
    const signupNickname = document.getElementById("signup-nickname-input");
    const signupPassword = document.getElementById("signup-password-input");
    const signupButton = document.getElementById("signup-submit");
    const signupError = document.getElementById("signup-error");

    const guestNickname = document.getElementById("guest-nickname-input");
    const guestButton = document.getElementById("guest-submit");
    const guestError = document.getElementById("guest-error");

    setNicknameModalVisibility(modal, true);

    function selectTab(which) {
      const panels = { login: loginPanel, signup: signupPanel, guest: guestPanel };
      const tabs = { login: loginTab, signup: signupTab, guest: guestTab };
      Object.entries(tabs).forEach(([key, tab]) => tab.setAttribute("aria-selected", String(key === which)));
      Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle("hidden", key !== which));
      ({ login: loginEmail, signup: signupEmail, guest: guestNickname })[which].focus();
    }
    loginTab.addEventListener("click", () => selectTab("login"));
    signupTab.addEventListener("click", () => selectTab("signup"));
    guestTab.addEventListener("click", () => selectTab("guest"));
    requestAnimationFrame(() => selectTab("login"));

    loginButton.addEventListener("click", async () => {
      const email = validateEmail(loginEmail.value);
      const password = validatePassword(loginPassword.value);
      loginError.textContent = email.message || password.message;
      if (email.message || password.message) return;
      unlockAudio().catch(console.error);
      loginButton.disabled = true;
      loginError.textContent = "";
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.value,
          password: password.value,
        });
        if (error) throw error;
        const { data: profile } = await supabase.from("profiles").select().eq("uid", data.user.id).single();
        setNicknameModalVisibility(modal, false);
        resolve({ uid: data.user.id, nickname: profile?.nickname ?? "게스트", isGuest: profile?.is_guest ?? false });
      } catch (err) {
        loginError.textContent = "이메일 또는 비밀번호가 올바르지 않아요.";
      } finally {
        loginButton.disabled = false;
      }
    });
    loginPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loginButton.click();
    });

    signupButton.addEventListener("click", async () => {
      const email = validateEmail(signupEmail.value);
      const nickname = validateNickname(signupNickname.value);
      const password = validatePassword(signupPassword.value);
      signupError.textContent = email.message || nickname.message || password.message;
      if (email.message || nickname.message || password.message) return;
      unlockAudio().catch(console.error);
      signupButton.disabled = true;
      signupError.textContent = "";
      try {
        const { data, error } = await supabase.auth.signUp({
          email: email.value,
          password: password.value,
        });
        if (error) throw error;
        if (!data.session) {
          // Supabase 프로젝트의 Auth 설정에서 이메일 인증이 켜져 있으면 가입 직후 세션이 없다.
          // 이 상태로 넘어가면 profiles upsert가 RLS(auth.uid())에 막혀 원인을 알 수 없는 에러가 된다.
          signupError.textContent = "이메일 인증이 필요해요. 받은 메일함을 확인해 주세요.";
          return;
        }
        await supabase.from("profiles").upsert({ uid: data.user.id, nickname: nickname.value, is_guest: false });
        setNicknameModalVisibility(modal, false);
        resolve({ uid: data.user.id, nickname: nickname.value, isGuest: false });
      } catch (err) {
        signupError.textContent = err.message?.includes("already registered")
          ? "이미 가입된 이메일이에요."
          : err.message?.includes("rate limit")
          ? "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요."
          : "가입에 실패했어요. 잠시 후 다시 시도해 주세요.";
      } finally {
        signupButton.disabled = false;
      }
    });
    signupPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") signupButton.click();
    });

    guestButton.addEventListener("click", async () => {
      const nickname = validateNickname(guestNickname.value);
      guestError.textContent = nickname.message;
      if (nickname.message) return;
      unlockAudio().catch(console.error);
      guestButton.disabled = true;
      guestError.textContent = "";
      try {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        await supabase.from("profiles").upsert({
          uid: data.user.id,
          nickname: nickname.value,
          is_guest: true,
        });
        setNicknameModalVisibility(modal, false);
        resolve({ uid: data.user.id, nickname: nickname.value, isGuest: true });
      } catch (err) {
        guestError.textContent = "게스트로 입장하지 못했어요. 잠시 후 다시 시도해 주세요.";
      } finally {
        guestButton.disabled = false;
      }
    });
    guestNickname.addEventListener("keydown", (e) => {
      if (e.key === "Enter") guestButton.click();
    });
  });
}
