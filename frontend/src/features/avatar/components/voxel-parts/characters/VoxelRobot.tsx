/**
 * VoxelRobot - Robot character with antenna
 * Gray body with green accents and yellow eyes
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelRobotProps {
  animate?: boolean;
}

// Robot colors
const COLORS = {
  body: '#607D8B',       // Gray body
  accent: '#4CAF50',     // Green accents
  dark: '#37474F',       // Dark parts
  eye: '#FFEB3B',        // Yellow eyes
};

export function VoxelRobot({ animate = false }: VoxelRobotProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Robot mechanical movement
      groupRef.current.position.y = Math.sin(time * 2) * 0.02;
      // Slight rotation
      groupRef.current.rotation.y = Math.sin(time * 1.2) * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      {/* === HEAD === */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.45, 0.4, 0.35]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.6} />
      </mesh>

      {/* === ANTENNA === */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[0.05, 0.15, 0.05]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color={COLORS.accent} flatShading emissive={COLORS.accent} emissiveIntensity={0.3} />
      </mesh>

      {/* === EYES === */}
      <mesh position={[-0.12, 0.78, 0.18]}>
        <boxGeometry args={[0.1, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eye} />
      </mesh>
      <mesh position={[0.12, 0.78, 0.18]}>
        <boxGeometry args={[0.1, 0.1, 0.02]} />
        <meshBasicMaterial color={COLORS.eye} />
      </mesh>

      {/* Eye pupils */}
      <mesh position={[-0.12, 0.78, 0.19]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshBasicMaterial color={COLORS.dark} />
      </mesh>
      <mesh position={[0.12, 0.78, 0.19]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshBasicMaterial color={COLORS.dark} />
      </mesh>

      {/* === MOUTH === */}
      <mesh position={[0, 0.62, 0.18]}>
        <boxGeometry args={[0.2, 0.04, 0.02]} />
        <meshBasicMaterial color={COLORS.dark} />
      </mesh>

      {/* === BODY === */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.5, 0.45, 0.35]} />
        <meshStandardMaterial color={COLORS.body} flatShading roughness={0.6} />
      </mesh>

      {/* Chest panel */}
      <mesh position={[0, 0.38, 0.18]} castShadow>
        <boxGeometry args={[0.25, 0.2, 0.02]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>

      {/* Chest light */}
      <mesh position={[0, 0.4, 0.19]} castShadow>
        <boxGeometry args={[0.12, 0.12, 0.02]} />
        <meshStandardMaterial color={COLORS.accent} flatShading emissive={COLORS.accent} emissiveIntensity={0.3} />
      </mesh>

      {/* === ARMS === */}
      <mesh position={[-0.35, 0.35, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.15]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>
      <mesh position={[0.35, 0.35, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.15]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>

      {/* === HANDS === */}
      <mesh position={[-0.35, 0.1, 0]} castShadow>
        <boxGeometry args={[0.12, 0.1, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading />
      </mesh>
      <mesh position={[0.35, 0.1, 0]} castShadow>
        <boxGeometry args={[0.12, 0.1, 0.12]} />
        <meshStandardMaterial color={COLORS.body} flatShading />
      </mesh>

      {/* === LEGS === */}
      <mesh position={[-0.12, 0.02, 0]} castShadow>
        <boxGeometry args={[0.15, 0.2, 0.18]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>
      <mesh position={[0.12, 0.02, 0]} castShadow>
        <boxGeometry args={[0.15, 0.2, 0.18]} />
        <meshStandardMaterial color={COLORS.dark} flatShading />
      </mesh>

      {/* === FEET === */}
      <mesh position={[-0.12, -0.1, 0.03]} castShadow>
        <boxGeometry args={[0.18, 0.06, 0.22]} />
        <meshStandardMaterial color={COLORS.body} flatShading />
      </mesh>
      <mesh position={[0.12, -0.1, 0.03]} castShadow>
        <boxGeometry args={[0.18, 0.06, 0.22]} />
        <meshStandardMaterial color={COLORS.body} flatShading />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelRobot;
