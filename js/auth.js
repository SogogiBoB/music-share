import { supabase } from "./supabaseClient.js";
import { unlockAudio } from "./player.js";

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

const GUEST_PLACEHOLDER = "게스트";
const MEMBER_PLACEHOLDER = "리스너";

// 표시용 닉네임을 정한다. 저장된 닉네임이 최우선이고, 정회원인데 값이 "게스트"
// 자리표시자로 남아 있으면(예전 로직이 덮어쓴 흔적) "리스너" 로 되돌린다.
// 이메일은 다른 참여자에게 노출되므로 닉네임 후보로 쓰지 않는다.
export function deriveNickname({ storedNickname, isAnonymous } = {}) {
  const stored = String(storedNickname ?? "").trim();
  if (stored && !(stored === GUEST_PLACEHOLDER && !isAnonymous)) return stored;
  return isAnonymous ? GUEST_PLACEHOLDER : MEMBER_PLACEHOLDER;
}

export async function ensureIdentity() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    const uid = session.user.id;
    const isAnonymous = session.user.is_anonymous === true || !session.user.email;
    const { data: profile } = await supabase.from("profiles").select().eq("uid", uid).single();
    setNicknameModalVisibility(document.getElementById("nickname-modal"), false);

    const nickname = deriveNickname({
      storedNickname: profile?.nickname,
      isAnonymous,
    });
    const isGuest = profile?.is_guest ?? isAnonymous;

    // 매 로드마다 무조건 쓰면 자리표시자가 실제 닉네임을 지운다. 값이 달라질 때만 쓴다.
    // 기존 행을 갱신할 때는 is_guest 를 보내지 않는다("본인 프로필만 수정" 정책이
    // is_guest 변경을 막고, 보내지 않으면 기존 값이 유지된다).
    if (!profile) {
      await supabase.from("profiles").insert({ uid, nickname, is_guest: isGuest });
    } else if (profile.nickname !== nickname) {
      await supabase.from("profiles").update({ nickname }).eq("uid", uid);
    }

    return { uid, nickname, isGuest, fromPrompt: false };
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
    requestAnimationFrame(() => selectTab("guest"));

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
        const nickname = deriveNickname({
          storedNickname: profile?.nickname,
          isAnonymous: false,
        });
        // 프로필 행이 없는 계정(구버전 가입자)도 게스트로 굳지 않게 여기서 만들어 둔다.
        if (!profile) {
          await supabase.from("profiles").insert({ uid: data.user.id, nickname, is_guest: false });
        } else if (profile.nickname !== nickname) {
          await supabase.from("profiles").update({ nickname }).eq("uid", data.user.id);
        }
        setNicknameModalVisibility(modal, false);
        resolve({ uid: data.user.id, nickname, isGuest: profile?.is_guest ?? false });
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
