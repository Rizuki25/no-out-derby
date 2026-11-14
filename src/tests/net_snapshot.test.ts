import { describe, expect, it } from 'vitest';
import { createEmptyInput, MatchState } from '../game/MatchState.ts';
import {
  ActionEdgeTracker,
  buildNetSnapshot,
  HostRemoteInputDecoder,
  NetInterpolator,
} from '../net/NetSnapshot.ts';
import { FIXED_DT } from '../types.ts';

describe('WebRTC Netcode Edge Reliability & Snapshot Interpolation', () => {
  it('delivers edge button actions once on Host even when unreliable packets drop', () => {
    const sender = new ActionEdgeTracker();
    const decoder = new HostRemoteInputDecoder();

    // Packet 1 arrives cleanly (idle)
    const p1 = sender.encode(createEmptyInput());
    decoder.ingest(p1);
    const t1 = decoder.consumeTick();
    expect(t1.input.kickJustReleased).toBe(false);

    // Packet 2 has kickJustReleased + passJustPressed + directTactic='attack', simulate UDP packet loss!
    const kickAndPass = {
      ...createEmptyInput(),
      moveX: 0.75,
      kickJustReleased: true,
      passJustPressed: true,
    };
    const _droppedPkt2 = sender.encode(kickAndPass, 'attack');
    void _droppedPkt2;

    // Packet 3 arrives later with edge booleans back to false, carrying bumped action counters
    const p3 = sender.encode({ ...createEmptyInput(), moveX: 0.75 });
    decoder.ingest(p3);
    const t3 = decoder.consumeTick();
    expect(t3.input.kickJustReleased).toBe(true);
    expect(t3.input.passJustPressed).toBe(true);
    expect(t3.directTactic).toBe('attack');
    expect(t3.input.moveX).toBeCloseTo(0.75, 2);

    // Packet 4 must NOT double-trigger the already consumed kick/pass edges
    const p4 = sender.encode({ ...createEmptyInput(), moveX: 0.5 });
    decoder.ingest(p4);
    const t4 = decoder.consumeTick();
    expect(t4.input.kickJustReleased).toBe(false);
    expect(t4.input.passJustPressed).toBe(false);
    expect(t4.directTactic).toBeNull();
  });

  it('smoothly interpolates entity positions on Guest and snaps cleanly across kickoff teleports', () => {
    const hostMatch = new MatchState();
    hostMatch.startMatch({
      mode: '4v4_local',
      arena: 'classic',
      pitchSize: 'xl',
      controlStyle: 'dribble',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: true,
    });
    hostMatch.phase = 'PLAYING';
    hostMatch.teamFeverA = 88;
    hostMatch.setTeamTactic('B', 'attack');

    const interp = new NetInterpolator();
    const p0 = hostMatch.players[0];
    const startX = p0.x;

    // Build snapshot #1 at simTime = 100ms
    const snap1 = buildNetSnapshot(hostMatch, 1, 100, true);
    interp.pushSnapshot(snap1, 1000);

    // Advance player +20px smoothly -> snapshot #2 at simTime = 200ms
    hostMatch.players[0].x = startX + 20;
    const snap2 = buildNetSnapshot(hostMatch, 2, 200, false);
    interp.pushSnapshot(snap2, 1100);

    // Out-of-order older packet is rejected
    expect(interp.pushSnapshot({ ...snap1, seq: 1 }, 1110)).toBe(false);

    // Sample halfway between snap1 (sim 100) and snap2 (sim 200):
    // hostClockOffsetMs ~ 900 -> renderSimTime at localNow=1092 = 1092 - 900 - 42 = 150ms (t = 0.5)
    const halfway = interp.sample(1092);
    expect(halfway).not.toBeNull();
    expect(halfway!.players[0].x).toBeCloseTo(startX + 10, 0);

    // Mirror onto a Guest MatchState cleanly
    const guestMatch = new MatchState();
    guestMatch.startMatch(hostMatch.config);
    guestMatch.applyRemoteSnapshot(halfway!);
    expect(guestMatch.players).toHaveLength(8); // 4v4 = 8 entities synced
    expect(guestMatch.teamFeverA).toBeCloseTo(88, 1);
    expect(guestMatch.teamTacticB).toBe('attack');
    expect(guestMatch.players[0].x).toBeCloseTo(startX + 10, 0);

    // Large distance jump (> 72px, e.g. kickoff reset) snaps instead of lagging mid-field
    hostMatch.players[0].x = startX + 180;
    const snap3 = buildNetSnapshot(hostMatch, 3, 250, false);
    interp.pushSnapshot(snap3, 1150);
    const snapped = interp.sample(1167); // renderSimTime = 225ms (between snap2 @ 200 & snap3 @ 250)
    expect(snapped!.players[0].x).toBeCloseTo(startX + 180, 1);
  });

  it('mirrors Host Goal Replay frame onto Guest ReplayBuffer cleanly', () => {
    const hostMatch = new MatchState();
    hostMatch.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      pitchSize: 'standard',
      controlStyle: 'dribble',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: true,
    });
    hostMatch.phase = 'PLAYING';
    for (let i = 0; i < 40; i++) {
      hostMatch.update(FIXED_DT, {
        p1: { ...createEmptyInput(), moveX: 1 },
        p2: createEmptyInput(),
      });
    }
    expect(hostMatch.replay.startPlayback('TOP BINZ!', 'A')).toBe(true);
    hostMatch.phase = 'REPLAY';

    const snap = buildNetSnapshot(hostMatch, 10, 1000, false);
    expect(snap.replay?.frame).not.toBeNull();
    expect(snap.replay?.tag).toBe('TOP BINZ!');

    const guestMatch = new MatchState();
    guestMatch.startMatch(hostMatch.config);
    guestMatch.applyRemoteSnapshot(snap);

    expect(guestMatch.phase).toBe('REPLAY');
    expect(guestMatch.replay.activeGoalTag).toBe('TOP BINZ!');
    expect(guestMatch.replay.scoringTeam).toBe('A');
    expect(guestMatch.replay.getCurrentPlaybackFrame()).not.toBeNull();
  });
});
