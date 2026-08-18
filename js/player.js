export function computeExpectedPosition({ isPlaying, positionAtStart, serverStartedAt }) {
  if (!isPlaying) return positionAtStart;
  const elapsedSec = (Date.now() - new Date(serverStartedAt).getTime()) / 1000;
  return positionAtStart + elapsedSec;
}
