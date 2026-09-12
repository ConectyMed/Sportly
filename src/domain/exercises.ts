import type { ExerciseDefinition, EquipmentId, MuscleGroup } from './types'

const ex = (
  id: string,
  name: string,
  primary: MuscleGroup,
  muscles: MuscleGroup[],
  pattern: ExerciseDefinition['pattern'],
  equipment: EquipmentId[],
  level: 1 | 2 | 3,
  compound: boolean,
  cue: string,
  extra: Partial<ExerciseDefinition> = {},
): ExerciseDefinition => ({
  id,
  name,
  primary,
  muscles,
  pattern,
  equipment,
  level,
  compound,
  cue,
  ...extra,
})

export const EXERCISES: ExerciseDefinition[] = [
  // Chest — horizontal push
  ex('bench_press', 'Bench Press', 'chest', ['chest', 'triceps', 'shoulders'], 'horizontal_push', ['barbell', 'bench'], 2, true, 'Feet planted, slight arch, bar to lower chest.', { loadRatio: 0.9 }),
  ex('db_bench_press', 'Dumbbell Bench Press', 'chest', ['chest', 'triceps', 'shoulders'], 'horizontal_push', ['dumbbell', 'bench'], 1, true, 'Elbows at ~45°, full stretch at the bottom.', { loadRatio: 0.3 }),
  ex('incline_db_press', 'Incline Dumbbell Press', 'chest', ['chest', 'shoulders', 'triceps'], 'horizontal_push', ['dumbbell', 'bench'], 2, true, 'Bench at 30°, press up and slightly back.', { loadRatio: 0.26 }),
  ex('push_up', 'Push-Up', 'chest', ['chest', 'triceps', 'core'], 'horizontal_push', ['bodyweight'], 1, true, 'Body in one line, chest to the floor.', { loadRatio: 0 }),
  ex('machine_chest_press', 'Machine Chest Press', 'chest', ['chest', 'triceps'], 'horizontal_push', ['machine'], 1, true, 'Handles at mid-chest, squeeze at lockout.', { loadRatio: 0.7 }),
  ex('cable_fly', 'Cable Fly', 'chest', ['chest'], 'isolation', ['cable'], 1, false, 'Slight bend in the elbows, hug a tree.', { loadRatio: 0.15 }),
  ex('db_fly', 'Dumbbell Fly', 'chest', ['chest'], 'isolation', ['dumbbell', 'bench'], 1, false, 'Wide arc, stop when you feel the stretch.', { loadRatio: 0.12 }),

  // Shoulders — vertical push
  ex('overhead_press', 'Overhead Press', 'shoulders', ['shoulders', 'triceps', 'core'], 'vertical_push', ['barbell'], 2, true, 'Brace, bar path straight up, head through.', { loadRatio: 0.55 }),
  ex('db_shoulder_press', 'Dumbbell Shoulder Press', 'shoulders', ['shoulders', 'triceps'], 'vertical_push', ['dumbbell'], 1, true, 'Start at ear height, press to lockout.', { loadRatio: 0.2 }),
  ex('lateral_raise', 'Lateral Raise', 'shoulders', ['shoulders'], 'isolation', ['dumbbell'], 1, false, 'Lead with the elbows, stop at shoulder height.', { loadRatio: 0.09 }),
  ex('cable_lateral_raise', 'Cable Lateral Raise', 'shoulders', ['shoulders'], 'isolation', ['cable'], 1, false, 'Constant tension, slow on the way down.', { loadRatio: 0.06 }),
  ex('face_pull', 'Face Pull', 'shoulders', ['shoulders', 'back'], 'horizontal_pull', ['cable', 'band'], 1, false, 'Pull to the forehead, elbows high.', { loadRatio: 0.2 }),
  ex('pike_push_up', 'Pike Push-Up', 'shoulders', ['shoulders', 'triceps'], 'vertical_push', ['bodyweight'], 2, true, 'Hips high, head toward the floor.', { loadRatio: 0 }),

  // Back — pulls
  ex('pull_up', 'Pull-Up', 'back', ['back', 'biceps'], 'vertical_pull', ['pullup_bar', 'bodyweight'], 3, true, 'Chest to bar, control the descent.', { loadRatio: 0 }),
  ex('lat_pulldown', 'Lat Pulldown', 'back', ['back', 'biceps'], 'vertical_pull', ['cable', 'machine'], 1, true, 'Drive elbows to your hips, bar to upper chest.', { loadRatio: 0.7 }),
  ex('barbell_row', 'Barbell Row', 'back', ['back', 'biceps', 'hamstrings'], 'horizontal_pull', ['barbell'], 2, true, 'Hinge at 45°, row to the lower ribs.', { loadRatio: 0.75 }),
  ex('db_row', 'Dumbbell Row', 'back', ['back', 'biceps'], 'horizontal_pull', ['dumbbell', 'bench'], 1, true, 'Pull toward the hip, pause at the top.', { loadRatio: 0.32, unilateral: true }),
  ex('cable_row', 'Cable Row', 'back', ['back', 'biceps'], 'horizontal_pull', ['cable'], 1, true, 'Chest tall, squeeze the shoulder blades.', { loadRatio: 0.75 }),
  ex('chest_supported_row', 'Chest-Supported Row', 'back', ['back', 'biceps'], 'horizontal_pull', ['dumbbell', 'bench'], 1, true, 'Chest on the pad, elbows drive back.', { loadRatio: 0.25 }),
  ex('inverted_row', 'Inverted Row', 'back', ['back', 'biceps', 'core'], 'horizontal_pull', ['bodyweight'], 1, true, 'Body straight, chest to the bar.', { loadRatio: 0 }),
  ex('band_pull_apart', 'Band Pull-Apart', 'back', ['back', 'shoulders'], 'horizontal_pull', ['band'], 1, false, 'Arms straight, pull the band to the chest.', { loadRatio: 0 }),
  ex('straight_arm_pulldown', 'Straight-Arm Pulldown', 'back', ['back'], 'isolation', ['cable'], 1, false, 'Arms nearly straight, sweep to the thighs.', { loadRatio: 0.3 }),

  // Arms
  ex('db_curl', 'Dumbbell Curl', 'biceps', ['biceps'], 'isolation', ['dumbbell'], 1, false, 'Elbows pinned, full range.', { loadRatio: 0.15 }),
  ex('barbell_curl', 'Barbell Curl', 'biceps', ['biceps'], 'isolation', ['barbell'], 1, false, 'No swing, squeeze at the top.', { loadRatio: 0.35 }),
  ex('hammer_curl', 'Hammer Curl', 'biceps', ['biceps'], 'isolation', ['dumbbell'], 1, false, 'Neutral grip, control the negative.', { loadRatio: 0.16 }),
  ex('cable_curl', 'Cable Curl', 'biceps', ['biceps'], 'isolation', ['cable'], 1, false, 'Constant tension, elbows still.', { loadRatio: 0.3 }),
  ex('triceps_pushdown', 'Triceps Pushdown', 'triceps', ['triceps'], 'isolation', ['cable'], 1, false, 'Elbows tucked, full lockout.', { loadRatio: 0.35 }),
  ex('overhead_triceps_extension', 'Overhead Triceps Extension', 'triceps', ['triceps'], 'isolation', ['dumbbell', 'cable'], 1, false, 'Elbows in, deep stretch behind the head.', { loadRatio: 0.22 }),
  ex('skull_crusher', 'Skull Crusher', 'triceps', ['triceps'], 'isolation', ['barbell', 'dumbbell', 'bench'], 2, false, 'Lower to the forehead, elbows steady.', { loadRatio: 0.3 }),
  ex('dip', 'Dip', 'triceps', ['triceps', 'chest', 'shoulders'], 'vertical_push', ['bodyweight'], 2, true, 'Lean slightly forward, elbows to 90°.', { loadRatio: 0 }),
  ex('diamond_push_up', 'Diamond Push-Up', 'triceps', ['triceps', 'chest'], 'horizontal_push', ['bodyweight'], 2, true, 'Hands under the chest, elbows tight.', { loadRatio: 0 }),

  // Legs — squat / hinge / lunge
  ex('back_squat', 'Back Squat', 'quads', ['quads', 'glutes', 'core'], 'squat', ['barbell'], 2, true, 'Brace, sit between the heels, drive up.', { loadRatio: 1.1 }),
  ex('front_squat', 'Front Squat', 'quads', ['quads', 'core', 'glutes'], 'squat', ['barbell'], 3, true, 'Elbows high, chest tall.', { loadRatio: 0.8 }),
  ex('goblet_squat', 'Goblet Squat', 'quads', ['quads', 'glutes', 'core'], 'squat', ['dumbbell', 'kettlebell'], 1, true, 'Hold at the chest, elbows inside the knees.', { loadRatio: 0.3 }),
  ex('leg_press', 'Leg Press', 'quads', ['quads', 'glutes'], 'squat', ['machine'], 1, true, 'Feet mid-platform, don’t lock out hard.', { loadRatio: 1.8 }),
  ex('hack_squat', 'Hack Squat', 'quads', ['quads', 'glutes'], 'squat', ['machine'], 2, true, 'Deep and controlled.', { loadRatio: 1.0 }),
  ex('bodyweight_squat', 'Bodyweight Squat', 'quads', ['quads', 'glutes'], 'squat', ['bodyweight'], 1, true, 'Full depth, knees track the toes.', { loadRatio: 0 }),
  ex('split_squat', 'Bulgarian Split Squat', 'quads', ['quads', 'glutes'], 'lunge', ['dumbbell', 'bodyweight', 'bench'], 2, true, 'Rear foot elevated, drop straight down.', { loadRatio: 0.2, unilateral: true }),
  ex('walking_lunge', 'Walking Lunge', 'quads', ['quads', 'glutes'], 'lunge', ['dumbbell', 'bodyweight'], 1, true, 'Long stride, torso tall.', { loadRatio: 0.18, unilateral: true }),
  ex('reverse_lunge', 'Reverse Lunge', 'quads', ['quads', 'glutes'], 'lunge', ['dumbbell', 'bodyweight'], 1, true, 'Step back, knee to the floor.', { loadRatio: 0.18, unilateral: true }),
  ex('step_up', 'Step-Up', 'glutes', ['glutes', 'quads'], 'lunge', ['dumbbell', 'bodyweight', 'bench'], 1, true, 'Drive through the front heel.', { loadRatio: 0.15, unilateral: true }),
  ex('leg_extension', 'Leg Extension', 'quads', ['quads'], 'isolation', ['machine'], 1, false, 'Pause at the top, slow down.', { loadRatio: 0.55 }),
  ex('deadlift', 'Deadlift', 'hamstrings', ['hamstrings', 'glutes', 'back', 'core'], 'hinge', ['barbell'], 3, true, 'Bar over mid-foot, push the floor away.', { loadRatio: 1.4 }),
  ex('romanian_deadlift', 'Romanian Deadlift', 'hamstrings', ['hamstrings', 'glutes', 'back'], 'hinge', ['barbell', 'dumbbell'], 2, true, 'Hips back, bar close, stretch the hamstrings.', { loadRatio: 0.9 }),
  ex('db_rdl', 'Dumbbell Romanian Deadlift', 'hamstrings', ['hamstrings', 'glutes'], 'hinge', ['dumbbell'], 1, true, 'Soft knees, hinge until you feel the stretch.', { loadRatio: 0.25 }),
  ex('hip_thrust', 'Hip Thrust', 'glutes', ['glutes', 'hamstrings'], 'hinge', ['barbell', 'dumbbell', 'bench'], 2, true, 'Chin tucked, squeeze hard at the top.', { loadRatio: 1.2 }),
  ex('glute_bridge', 'Glute Bridge', 'glutes', ['glutes', 'hamstrings'], 'hinge', ['bodyweight', 'dumbbell'], 1, true, 'Heels close, ribs down, squeeze.', { loadRatio: 0 }),
  ex('kb_swing', 'Kettlebell Swing', 'glutes', ['glutes', 'hamstrings', 'core'], 'hinge', ['kettlebell'], 2, true, 'Hinge, snap the hips, float the bell.', { loadRatio: 0.3 }),
  ex('leg_curl', 'Leg Curl', 'hamstrings', ['hamstrings'], 'isolation', ['machine'], 1, false, 'Slow negative, full contraction.', { loadRatio: 0.5 }),
  ex('nordic_curl', 'Nordic Curl', 'hamstrings', ['hamstrings'], 'isolation', ['bodyweight'], 3, false, 'Lower as slowly as you can.', { loadRatio: 0 }),
  ex('calf_raise', 'Standing Calf Raise', 'calves', ['calves'], 'isolation', ['machine', 'dumbbell', 'bodyweight'], 1, false, 'Full stretch, pause at the top.', { loadRatio: 0.6 }),

  // Core
  ex('plank', 'Plank', 'core', ['core'], 'core', ['bodyweight'], 1, false, 'Ribs down, glutes tight.', { timed: true }),
  ex('dead_bug', 'Dead Bug', 'core', ['core'], 'core', ['bodyweight'], 1, false, 'Lower back glued to the floor.', {}),
  ex('hanging_knee_raise', 'Hanging Knee Raise', 'core', ['core'], 'core', ['pullup_bar'], 2, false, 'Curl the pelvis, no swinging.', {}),
  ex('cable_crunch', 'Cable Crunch', 'core', ['core'], 'core', ['cable'], 1, false, 'Crunch the ribs toward the hips.', { loadRatio: 0.4 }),
  ex('ab_wheel', 'Ab Wheel Rollout', 'core', ['core'], 'core', ['bodyweight'], 3, false, 'Only as far as you can stay flat.', {}),
  ex('pallof_press', 'Pallof Press', 'core', ['core'], 'core', ['cable', 'band'], 1, false, 'Resist the rotation, press slow.', { loadRatio: 0.15 }),
  ex('side_plank', 'Side Plank', 'core', ['core'], 'core', ['bodyweight'], 1, false, 'Stack the feet, hips high.', { timed: true, unilateral: true }),
  ex('farmer_carry', 'Farmer Carry', 'core', ['core', 'back', 'full_body'], 'carry', ['dumbbell', 'kettlebell'], 1, true, 'Tall posture, quick steps.', { loadRatio: 0.35, timed: true }),

  // Conditioning
  ex('bike_intervals', 'Bike Intervals', 'cardio', ['cardio'], 'conditioning', ['cardio_machine'], 1, false, 'Hard 30s, easy 60s.', { timed: true }),
  ex('rower_intervals', 'Rowing Intervals', 'cardio', ['cardio', 'back'], 'conditioning', ['cardio_machine'], 1, false, 'Legs, body, arms — then reverse.', { timed: true }),
  ex('incline_walk', 'Incline Walk', 'cardio', ['cardio'], 'conditioning', ['cardio_machine'], 1, false, 'Steady pace, nose breathing if you can.', { timed: true }),
  ex('burpee', 'Burpee', 'cardio', ['cardio', 'full_body'], 'conditioning', ['bodyweight'], 2, true, 'Chest to floor, jump and reach.', {}),
  ex('mountain_climber', 'Mountain Climber', 'cardio', ['cardio', 'core'], 'conditioning', ['bodyweight'], 1, false, 'Hips low, fast knees.', { timed: true }),
  ex('jump_rope', 'Jump Rope', 'cardio', ['cardio', 'calves'], 'conditioning', ['bodyweight'], 1, false, 'Light on the feet, wrists do the work.', { timed: true }),
  ex('kb_snatch', 'Kettlebell Snatch', 'cardio', ['cardio', 'glutes', 'shoulders'], 'conditioning', ['kettlebell'], 3, true, 'Punch through at the top.', {}),
  ex('sprint', 'Sprint Intervals', 'cardio', ['cardio', 'glutes'], 'conditioning', ['bodyweight'], 2, false, 'All-out 20s, walk back to recover.', { timed: true }),

  // Mobility
  ex('hip_90_90', '90/90 Hip Switch', 'core', ['glutes', 'core'], 'mobility', ['bodyweight'], 1, false, 'Sit tall, rotate slowly.', { timed: true }),
  ex('cat_cow', 'Cat-Cow', 'core', ['core', 'back'], 'mobility', ['bodyweight'], 1, false, 'Move with the breath.', { timed: true }),
  ex('worlds_greatest_stretch', 'World’s Greatest Stretch', 'full_body', ['full_body'], 'mobility', ['bodyweight'], 1, false, 'Long lunge, rotate toward the front knee.', { timed: true, unilateral: true }),
  ex('thoracic_rotation', 'Thoracic Rotation', 'back', ['back'], 'mobility', ['bodyweight'], 1, false, 'Reach and open the chest.', { timed: true, unilateral: true }),
  ex('couch_stretch', 'Couch Stretch', 'quads', ['quads'], 'mobility', ['bodyweight'], 1, false, 'Squeeze the glute, breathe.', { timed: true, unilateral: true }),
]

export const EXERCISE_MAP: Record<string, ExerciseDefinition> = Object.fromEntries(EXERCISES.map((e) => [e.id, e]))

export function getExercise(id: string): ExerciseDefinition {
  return EXERCISE_MAP[id] ?? { ...EXERCISES[0], id, name: id }
}

export function findExerciseByName(query: string): ExerciseDefinition | undefined {
  const q = query.toLowerCase().trim()
  if (!q) return undefined
  return (
    EXERCISES.find((e) => e.name.toLowerCase() === q) ??
    EXERCISES.find((e) => e.name.toLowerCase().includes(q)) ??
    EXERCISES.find((e) => q.includes(e.name.toLowerCase().split(' ')[0]) && e.name.toLowerCase().split(' ').length === 1) ??
    EXERCISES.find((e) => e.id.replace(/_/g, ' ').includes(q))
  )
}

export const EQUIPMENT_LABELS: Record<EquipmentId, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  kettlebell: 'Kettlebell',
  cable: 'Cables',
  machine: 'Machines',
  bodyweight: 'Bodyweight',
  band: 'Bands',
  pullup_bar: 'Pull-up bar',
  bench: 'Bench',
  cardio_machine: 'Cardio machine',
}

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  full_body: 'Full body',
  cardio: 'Conditioning',
}

/** Estimated one-rep max (Epley). */
export function e1rm(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg
  return weightKg * (1 + reps / 30)
}
