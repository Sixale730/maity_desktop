/**
 * Auth Types - Type definitions for authentication and user management
 */

/**
 * User role types
 */
export type UserRole = 'admin' | 'manager' | 'user';

/**
 * User phase/status in the onboarding flow
 */
export type UserPhase =
  | 'ACTIVE'           // User is fully onboarded and active
  | 'REGISTRATION'     // User needs to complete registration form
  | 'NO_COMPANY'       // User has no company assigned
  | 'PENDING'          // User is pending company invitation
  | 'UNAUTHORIZED';    // User is not authenticated

/**
 * User status object returned by my_status RPC
 */
export interface UserStatus {
  /** User's unique ID */
  id: string;

  /** User's authentication ID from Supabase Auth */
  auth_id: string;

  /** User's first name */
  first_name: string | null;

  /** User's last name */
  last_name: string | null;

  /** User's email */
  email: string;

  /** User's avatar URL */
  avatar_url: string | null;

  /** Company ID the user belongs to */
  company_id: string | null;

  /** Company name */
  company_name: string | null;

  /** Whether registration form is completed */
  registration_form_completed: boolean;

  /** Whether onboarding is completed */
  onboarding_completed: boolean;

  /** Whether platform tour is completed */
  platform_tour_completed: boolean | null;

  /** User's role in the company */
  role: UserRole | null;

  /** Account creation date */
  created_at: string;

  /** User phase — presente en el response de la RPC aunque no sea parte del schema tipado formal */
  phase?: string;
}

/**
 * Login credentials for email/password authentication
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Sign up data for new user registration
 */
export interface SignUpData {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}

/**
 * OAuth provider types supported by the platform
 */
export type OAuthProvider = 'google' | 'microsoft';

/**
 * Options for post-login processing
 */
export interface PostLoginOptions {
  /** Path to return to after login (optional) */
  returnTo?: string | null;

  /** Access token for API calls (optional, will get from session if not provided) */
  accessToken?: string;
}

/**
 * Result of post-login processing
 */
export interface PostLoginResult {
  /** Destination path to navigate to */
  destination: string;

  /** Whether user was auto-joined to a company */
  autoJoined?: boolean;

  /** User's current phase */
  phase?: UserPhase;

  /** User's roles */
  roles?: UserRole[];
}
