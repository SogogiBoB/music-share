import { ensureIdentity } from "./auth.js?v=20260818-2";
import {
  claimDjIfVacant, fetchSettings, isCurrentDj, delegateDj,
  releaseDj, fetchProfiles, subscribeSettings, canClaimDj,
} from "./roles.js";
import { initPresence } from "./presence.js";
import { addTrack, fetchTracks, subscribeTracks } from "./playlist.js";
import {
  unlockAudio, fetchPlaybackState, subscribePlaybackState, applyPlaybackState,
  djSetTrack, djPlay, djPause, startDriftCorrection, waitForPlayerReady,
} from "./player.js?v=20260818";

function renderPresence(users, myUid, djUid, profileNicknames) {
  const list = document.getElementById("presence-list");
  const count = document.getElementById("presence-count");
  list.innerHTML = "";
  count.textContent = `${users.length}명`;
  for (const u of users) {
    const li = document.createElement("li");
    li.className = "member-item";
    const nickname = String(profileNicknames[u.uid] ?? u.nickname ?? "게스트");

    const avatar = document.createElement("span");
    avatar.className = "member-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = nickname.trim().charAt(0).toUpperCase() || "♪";
    li.appendChild(avatar);

    const copy = document.createElement("span");
    copy.className = "member-copy";
    const label = document.createElement("span");
    label.className = "member-name";
    // presence 메타데이터는 위조 가능하므로 profiles(RLS 보호) 의 닉네임을 우선한다.
    // 프로필 행이 아직 없는 순간에만 presence 값으로 폴백한다.
    label.textContent = nickname;
    const role = document.createElement("span");
    role.className = "member-role";
    role.textContent = u.uid === myUid ? "나" : "리스너";
    copy.append(label, role);
    li.appendChild(copy);
    if (u.uid === djUid) {
      const badge = document.createElement("span");
      badge.className = "badge-dj";
      badge.textContent = "DJ";
      li.appendChild(badge);
    }
    if (djUid === myUid && u.uid !== myUid) {
      const btn = document.createElement("button");
      btn.className = "delegate-button";
      btn.type = "button";
      btn.textContent = "DJ 위임";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await delegateDj(u.uid);
          location.reload();
        } catch (err) {
          btn.disabled = false;
          console.error(err);
          alert("DJ 역할을 위임하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      });
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
}

function renderTracks(tracks, amDj) {
  const list = document.getElementById("track-list");
  list.innerHTML = "";
  if (!tracks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.innerHTML = `
      <span class="empty-state-icon" aria-hidden="true">♫</span>
      <strong>아직 추가된 음악이 없어요</strong>
      <span>${amDj ? "위에 유튜브 링크를 붙여 첫 곡을 추가해 보세요." : "DJ가 곧 첫 곡을 골라 줄 거예요."}</span>
    `;
    list.appendChild(empty);
    return;
  }

  tracks.forEach((t, index) => {
    const li = document.createElement("li");
    li.className = "track-item";
    li.dataset.trackId = t.id;

    const row = document.createElement(amDj ? "button" : "div");
    row.className = "track-main";
    if (amDj) {
      row.type = "button";
      row.setAttribute("aria-label", `${t.title} 재생`);
      row.addEventListener("click", async () => {
        row.disabled = true;
        try {
          await djSetTrack(t.id);
        } catch (err) {
          console.error(err);
          alert("곡을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
          row.disabled = false;
        }
      });
    }

    const number = document.createElement("span");
    number.className = "track-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "track-copy";
    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = t.title;
    const meta = document.createElement("span");
    meta.className = "track-meta";
    meta.textContent = amDj ? "눌러서 바로 재생" : "YouTube track";
    copy.append(title, meta);
    row.append(number, copy);

    if (amDj) {
      const cue = document.createElement("span");
      cue.className = "track-cue";
      cue.setAttribute("aria-hidden", "true");
      cue.textContent = "▶";
      row.appendChild(cue);
    }

    li.appendChild(row);
    list.appendChild(li);
  });
}

function renderDjClaimAccess(settings, uid) {
  const button = document.getElementById("dj-claim-button");
  const status = document.getElementById("dj-claim-status");
  const amDj = isCurrentDj(settings, uid);
  const canClaim = canClaimDj(settings, uid);

  button.classList.toggle("hidden", !canClaim);
  button.disabled = false;
  status.textContent = amDj ? "현재 DJ입니다" : (canClaim ? "DJ 자리가 비어 있어요" : "DJ가 음악을 고르고 있어요");
}

async function loadProfileNicknames() {
  const profiles = await fetchProfiles();
  return Object.fromEntries(profiles.map((p) => [p.uid, p.nickname]));
}

async function bootstrap() {
  const identity = await ensureIdentity();
  const settings = await fetchSettings();
  const amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("controls-section").classList.toggle("hidden", !amDj);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  renderDjClaimAccess(settings, identity.uid);
  document.getElementById("app").classList.remove("hidden");

  let profileNicknames = await loadProfileNicknames();

  initPresence({
    uid: identity.uid,
    nickname: identity.nickname,
    onSync: async (users) => {
      // 새로 들어온 사람의 프로필을 반영하려면 sync 마다 다시 읽는다.
      // (subscribeTracks 가 변경마다 전체를 refetch 하는 것과 같은 패턴)
      try {
        profileNicknames = await loadProfileNicknames();
      } catch (err) {
        console.error(err);
      }
      renderPresence(users, identity.uid, settings.dj_uid, profileNicknames);
    },
  });

  // dj_uid 가 바뀌면(위임/반납) 모든 탭이 새 역할로 다시 뜬다.
  subscribeSettings(() => location.reload());

  document.getElementById("dj-claim-button").addEventListener("click", async () => {
    const button = document.getElementById("dj-claim-button");
    const status = document.getElementById("dj-claim-status");
    button.disabled = true;
    status.textContent = "DJ 권한을 요청하는 중…";
    try {
      const claimed = await claimDjIfVacant(identity.uid);
      if (!claimed) {
        button.classList.add("hidden");
        status.textContent = "다른 사람이 먼저 DJ가 되었어요.";
        return;
      }
      status.textContent = "DJ 권한을 가져왔어요.";
      location.reload();
    } catch (err) {
      console.error(err);
      button.disabled = false;
      status.textContent = "DJ 권한을 가져오지 못했어요. 다시 시도해 주세요.";
    }
  });

  // DJ 가 탭을 닫으면 역할을 반납해 방이 영구히 DJ 없는 상태가 되지 않게 한다.
  // DJ 가 아니면 release_dj() 는 아무 것도 하지 않는다.
  window.addEventListener("pagehide", () => {
    releaseDj().catch(() => {});
  });

  document.getElementById("add-track-button").addEventListener("click", async () => {
    const input = document.getElementById("youtube-url-input");
    const button = document.getElementById("add-track-button");
    const status = document.getElementById("add-track-status");
    const url = input.value.trim();
    status.className = "field-message";
    if (!url) {
      status.classList.add("is-error");
      status.textContent = "추가할 유튜브 링크를 입력해 주세요.";
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "추가 중…";
    status.textContent = "곡 정보를 확인하고 있어요.";
    try {
      await addTrack({ url, uid: identity.uid });
      input.value = "";
      status.classList.add("is-success");
      status.textContent = "재생목록에 추가했어요.";
    } catch (err) {
      console.error(err);
      status.classList.add("is-error");
      status.textContent = err.message === "유효하지 않은 유튜브 링크"
        ? "올바른 유튜브 링크를 입력해 주세요."
        : "곡을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">＋</span> 추가';
    }
  });

  document.getElementById("youtube-url-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.getElementById("add-track-button").click();
  });

  let currentTracks = await fetchTracks();
  renderTracks(currentTracks, amDj);
  subscribeTracks((tracks) => { currentTracks = tracks; renderTracks(tracks, amDj); });

  const applyState = async () => {
    const state = await fetchPlaybackState();
    await applyPlaybackState(state, currentTracks);
  };

  document.getElementById("listen-gate").classList.remove("hidden");
  document.getElementById("listen-start").addEventListener("click", async () => {
    await unlockAudio();
    document.getElementById("listen-gate").classList.add("hidden");
    // unlockAudio() 의 play/pause 로 플레이어가 멈춰 있으므로 실제 상태를 다시 적용한다.
    // 이게 없으면 곡 중간에 들어온 사람은 영원히 무음이다.
    await applyState();
  });

  let playerOk = true;
  try {
    await waitForPlayerReady();
  } catch (err) {
    playerOk = false;
    console.error(err);
    alert("음악 플레이어를 불러오지 못했습니다. 새로고침해 주세요.");
  }

  if (playerOk) {
    // 최초 1회: loadVideoById 로 영상을 물려두어야 unlockAudio() 의 play/pause 가 의미를 갖는다.
    await applyState();
    subscribePlaybackState(applyState);
    startDriftCorrection();
  }

  if (amDj) {
    document.getElementById("play-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      if (!state.current_track_id && currentTracks[0]) {
        await djSetTrack(currentTracks[0].id);
      } else {
        await djPlay(state.position_at_start);
      }
    });
    document.getElementById("pause-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      await djPause(state.position_at_start);
    });
    document.getElementById("next-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      const currentIndex = currentTracks.findIndex((t) => t.id === state.current_track_id);
      const next = currentTracks[currentIndex + 1];
      if (next) {
        await djSetTrack(next.id);
      }
    });
  }
}

bootstrap().catch((err) => {
  console.error(err);
  document.getElementById("nickname-modal")?.classList.add("hidden");
  document.getElementById("listen-gate")?.classList.add("hidden");
  const app = document.getElementById("app");
  app?.classList.remove("hidden");
  if (app) {
    app.innerHTML = `
      <section class="panel startup-error" role="alert">
        <span class="empty-state-icon" aria-hidden="true">!</span>
        <h1>음악방에 연결하지 못했어요</h1>
        <p>네트워크 연결을 확인한 뒤 페이지를 새로고침해 주세요.</p>
        <button class="button button-primary" type="button" onclick="location.reload()">새로고침</button>
      </section>
    `;
  }
});
