# Manual multiplayer smoke test

1. Start the server with `python -m uvicorn server.main:app --host 0.0.0.0`.
2. In one browser tab, import or load at least three questions, then choose
   **Host a room**, select a world, and create a room. Keep the large room code
   visible.
3. Open three more tabs (or phones on the same Wi-Fi), choose **Join a room**,
   enter that code, and use three different names. Check that all three names
   appear in the teacher lobby. Try joining with a duplicate name and a made-up
   code; both should produce a friendly error.
4. Start the race from the teacher tab. Confirm all student tabs show the same
   3-2-1 countdown and enter the stage. Confirm the teacher dashboard updates
   each student's status, lives, and progress without showing a playable game.
5. In the first student tab, deliberately fall or touch spikes three times.
   Confirm lives step down 3 → 2 → 1 → 0, the student is eliminated, and the
   waiting overlay shows how many students remain active.
6. In the other two tabs, answer a gate question incorrectly once. Confirm all
   answers lock for three seconds and the question remains. Answer correctly
   and confirm the gate opens. Finish with one student, then the other.
7. Confirm finishers are ordered by arrival with server-measured times, the
   eliminated student follows them, and all tabs show the same leaderboard
   with wrong-answer and death counts. Confirm the active student's row is
   highlighted.
8. During a second room, disconnect a student tab and reconnect it within 60
   seconds using **Rejoin your room**. Confirm the same name, lives, and
   checkpoint are restored. Disconnect and reconnect the teacher tab; confirm
   student gameplay pauses and resumes.
