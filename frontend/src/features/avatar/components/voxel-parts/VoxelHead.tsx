/**
 * VoxelHead - Authentic Crossy Road style head
 * BIG head (65% of character), simple face (just dot eyes)
 */

import { useRef } from 'react';
import * as THREE from 'three';
import type { HeadType } from '@maity/shared';

interface VoxelHeadProps {
  headType: HeadType;
  skinColor: string;
  hairColor: string;
}

// CROSSY ROAD PROPORTIONS: More cubic head, ~45% of character
const HEAD_DIMENSIONS: Record<HeadType, [number, number, number]> = {
  default: [0.8, 0.85, 0.75],
  round: [0.85, 0.8, 0.8],
  square: [0.85, 0.75, 0.75],
  tall: [0.75, 0.95, 0.7],
};

// Hair style variations - now with wrapping coverage
const HAIR_STYLES: Record<HeadType, 'short' | 'medium' | 'long' | 'business'> = {
  default: 'medium',
  round: 'long',
  square: 'short',
  tall: 'business',
};

export function VoxelHead({ headType, skinColor, hairColor }: VoxelHeadProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [headW, headH, headD] = HEAD_DIMENSIONS[headType];
  const hairStyle = HAIR_STYLES[headType];

  // Eye positioning - centered on face, classic Crossy Road style
  const eyeY = headH * 0.05;  // Slightly above center
  const eyeX = headW * 0.22;  // Wider apart
  const eyeZ = headD / 2 + 0.01;

  return (
    <group ref={groupRef} position={[0, 0.75, 0]}>
      {/* Main head block - cubic Crossy Road style */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[headW, headH, headD]} />
        <meshStandardMaterial
          color={skinColor}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Hair - wrapping around head like Crossy Road */}
      {hairStyle === 'short' && (
        <group position={[0, headH / 2, 0]}>
          {/* Top */}
          <mesh position={[0, 0.05, 0]} castShadow>
            <boxGeometry args={[headW * 0.95, 0.1, headD * 0.9]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Left side - short */}
          <mesh position={[-headW / 2, -0.05, 0]} castShadow>
            <boxGeometry args={[0.06, 0.18, headD * 0.7]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Right side - short */}
          <mesh position={[headW / 2, -0.05, 0]} castShadow>
            <boxGeometry args={[0.06, 0.18, headD * 0.7]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Back - short */}
          <mesh position={[0, -0.02, -headD / 2]} castShadow>
            <boxGeometry args={[headW * 0.85, 0.16, 0.06]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
        </group>
      )}

      {hairStyle === 'medium' && (
        <group position={[0, headH / 2, 0]}>
          {/* Top */}
          <mesh position={[0, 0.06, 0]} castShadow>
            <boxGeometry args={[headW * 0.98, 0.12, headD * 0.95]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Left side - medium length */}
          <mesh position={[-headW / 2, -0.1, 0]} castShadow>
            <boxGeometry args={[0.07, 0.3, headD * 0.75]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Right side - medium length */}
          <mesh position={[headW / 2, -0.1, 0]} castShadow>
            <boxGeometry args={[0.07, 0.3, headD * 0.75]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Back - medium */}
          <mesh position={[0, -0.05, -headD / 2]} castShadow>
            <boxGeometry args={[headW * 0.9, 0.25, 0.07]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Bangs - front */}
          <mesh position={[0, -0.08, headD / 2]} castShadow>
            <boxGeometry args={[headW * 0.7, 0.14, 0.06]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
        </group>
      )}

      {hairStyle === 'long' && (
        <group position={[0, headH / 2, 0]}>
          {/* Top */}
          <mesh position={[0, 0.06, 0]} castShadow>
            <boxGeometry args={[headW * 1.0, 0.12, headD * 0.98]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Left side - long */}
          <mesh position={[-headW / 2 - 0.01, -0.18, 0]} castShadow>
            <boxGeometry args={[0.08, 0.45, headD * 0.8]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Right side - long */}
          <mesh position={[headW / 2 + 0.01, -0.18, 0]} castShadow>
            <boxGeometry args={[0.08, 0.45, headD * 0.8]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Back - long */}
          <mesh position={[0, -0.12, -headD / 2 - 0.01]} castShadow>
            <boxGeometry args={[headW * 0.95, 0.4, 0.08]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Long bangs */}
          <mesh position={[0, -0.12, headD / 2 + 0.01]} castShadow>
            <boxGeometry args={[headW * 0.8, 0.2, 0.06]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
        </group>
      )}

      {hairStyle === 'business' && (
        <group position={[0, headH / 2, 0]}>
          {/* Top - neat and flat */}
          <mesh position={[0, 0.05, -0.02]} castShadow>
            <boxGeometry args={[headW * 0.92, 0.1, headD * 0.85]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Left side - trimmed */}
          <mesh position={[-headW / 2 + 0.01, -0.03, 0]} castShadow>
            <boxGeometry args={[0.05, 0.15, headD * 0.65]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Right side - trimmed */}
          <mesh position={[headW / 2 - 0.01, -0.03, 0]} castShadow>
            <boxGeometry args={[0.05, 0.15, headD * 0.65]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Back - short and neat */}
          <mesh position={[0, 0, -headD / 2 + 0.01]} castShadow>
            <boxGeometry args={[headW * 0.8, 0.12, 0.05]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
          {/* Side part detail */}
          <mesh position={[-headW * 0.25, 0.08, 0.05]} castShadow>
            <boxGeometry args={[0.08, 0.06, headD * 0.5]} />
            <meshStandardMaterial color={hairColor} flatShading roughness={0.9} />
          </mesh>
        </group>
      )}

      {/* CROSSY ROAD STYLE EYES: Just simple black squares! */}
      {/* Left eye - small black square */}
      <mesh position={[-eyeX, eyeY, eyeZ]}>
        <boxGeometry args={[0.08, 0.1, 0.02]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Right eye - small black square */}
      <mesh position={[eyeX, eyeY, eyeZ]}>
        <boxGeometry args={[0.08, 0.1, 0.02]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* NO CHEEKS - Crossy Road style is minimal */}
      {/* NO NOSE - Crossy Road style */}
      {/* NO MOUTH - Crossy Road style */}
    </group>
  );
}
