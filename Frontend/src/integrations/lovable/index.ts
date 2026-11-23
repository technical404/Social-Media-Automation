/** Local stub — cloud Lovable auth is not used. */
export const lovable = {
  auth: {
    signInWithOAuth: async () => ({ error: new Error("Cloud OAuth is not available in the local desktop app.") }),
  },
};
