type UserId = null | string | undefined;

export type HomeIntroPlayback = {
  shouldPlay: (userId: UserId) => boolean;
};

export const createHomeIntroPlayback = (): HomeIntroPlayback => {
  const playedUserIds = new Set<string>();

  return {
    shouldPlay(userId) {
      if (!userId || playedUserIds.has(userId)) {
        return false;
      }

      playedUserIds.add(userId);
      return true;
    },
  };
};

export const homeIntroPlayback = createHomeIntroPlayback();
