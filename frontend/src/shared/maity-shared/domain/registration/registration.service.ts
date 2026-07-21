import { supabase } from '../../api/client/supabase';
import { RegistrationFormData, FormResponse, LikertOnlyData } from './registration.types';

/**
 * Service for managing native registration form submissions
 * Handles form data persistence and user phase transitions
 */
export class RegistrationFormService {
  /**
   * Submit native registration form
   * @param userId - User's UUID from maity.users table
   * @param formData - Complete form data (20 questions)
   * @returns Promise with submission result
   */
  static async submitForm(
    userId: string,
    formData: RegistrationFormData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Insert form response
      const { error: insertError } = await supabase
        .schema('maity')
        .from('form_responses')
        .insert({
          user_id: userId,
          q1: formData.q1,
          q2: formData.q2,
          q3: formData.q3,
          q4: formData.q4,
          q5: formData.q5.toString(),
          q6: formData.q6.toString(),
          q7: formData.q7.toString(),
          q8: formData.q8.toString(),
          q9: formData.q9.toString(),
          q10: formData.q10.toString(),
          q11: formData.q11.toString(),
          q12: formData.q12.toString(),
          q13: formData.q13.toString(),
          q14: formData.q14.toString(),
          q15: formData.q15.toString(),
          q16: formData.q16.toString(),
          q17: formData.q17,
          q18: formData.q18 || null,
          q19: formData.q19 || null,
          raw: formData,
          submitted_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('[RegistrationFormService] Error inserting form:', insertError);
        throw insertError;
      }

      // 2. Update user to mark registration as complete + persist name
      const { error: updateError } = await supabase
        .schema('maity')
        .from('users')
        .update({
          first_name: formData.q1,
          last_name: formData.q2,
          registration_form_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (updateError) {
        console.error('[RegistrationFormService] Error updating user:', updateError);
        throw updateError;
      }

      console.log('[RegistrationFormService] ✅ Form submitted successfully for user:', userId);
      return { success: true };
    } catch (error: unknown) {
      console.error('[RegistrationFormService] ❌ Error submitting form:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al enviar el formulario. Por favor, intenta de nuevo.',
      };
    }
  }

  /**
   * Get user's form response
   * @param userId - User's UUID
   * @returns Promise with form response or null if not found
   */
  static async getUserFormResponse(userId: string): Promise<FormResponse | null> {
    try {
      const { data, error } = await supabase
        .schema('maity')
        .from('form_responses')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[RegistrationFormService] Error fetching form response:', error);
        throw error;
      }

      return data as FormResponse | null;
    } catch (error) {
      console.error('[RegistrationFormService] Error getting user form response:', error);
      return null;
    }
  }

  /**
   * Check if user has completed registration form
   * @param userId - User's UUID
   * @returns Promise<boolean>
   */
  static async hasCompletedForm(userId: string): Promise<boolean> {
    const response = await this.getUserFormResponse(userId);
    return response !== null;
  }

  /**
   * Save form progress to localStorage
   * @param userId - User's UUID
   * @param formData - Partial form data
   */
  static saveFormProgress(userId: string, formData: Partial<RegistrationFormData>): void {
    try {
      const key = `registration_progress_${userId}`;
      localStorage.setItem(key, JSON.stringify(formData));
      console.log('[RegistrationFormService] Progress saved to localStorage');
    } catch (error) {
      console.error('[RegistrationFormService] Error saving progress:', error);
    }
  }

  /**
   * Load form progress from localStorage
   * @param userId - User's UUID
   * @returns Partial form data or null
   */
  static loadFormProgress(userId: string): Partial<RegistrationFormData> | null {
    try {
      const key = `registration_progress_${userId}`;
      const data = localStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[RegistrationFormService] Error loading progress:', error);
      return null;
    }
  }

  /**
   * Clear form progress from localStorage
   * @param userId - User's UUID
   */
  static clearFormProgress(userId: string): void {
    try {
      const key = `registration_progress_${userId}`;
      localStorage.removeItem(key);
      console.log('[RegistrationFormService] Progress cleared from localStorage');
    } catch (error) {
      console.error('[RegistrationFormService] Error clearing progress:', error);
    }
  }

  /**
   * Calculate competency scores from form data
   * @param formData - Complete form data
   * @returns Competency scores by area
   */
  static calculateCompetencyScores(formData: RegistrationFormData): Record<string, number> {
    return {
      claridad: (formData.q5 + formData.q6) / 2,
      adaptacion: (formData.q7 + formData.q8) / 2,
      persuasion: (formData.q9 + formData.q10) / 2,
      estructura: (formData.q11 + formData.q12) / 2,
      proposito: (formData.q13 + formData.q14) / 2,
      empatia: (formData.q15 + formData.q16) / 2,
    };
  }

  /**
   * Calculate overall average score
   * @param formData - Complete form data
   * @returns Average score (1-5)
   */
  static calculateOverallScore(formData: RegistrationFormData): number {
    const sum =
      formData.q5 +
      formData.q6 +
      formData.q7 +
      formData.q8 +
      formData.q9 +
      formData.q10 +
      formData.q11 +
      formData.q12 +
      formData.q13 +
      formData.q14 +
      formData.q15 +
      formData.q16;

    return Math.round((sum / 12) * 10) / 10; // Round to 1 decimal
  }

  /**
   * Update only self-assessment Likert questions (q5-q16)
   * Used for admin testing to overwrite self-assessment without affecting personal info
   * @param userId - User's UUID
   * @param likertData - Likert questions data (q5-q16)
   * @returns Promise with update result
   */
  static async updateSelfAssessmentOnly(
    userId: string,
    likertData: LikertOnlyData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if user already has a form response
      const existingResponse = await this.getUserFormResponse(userId);

      if (existingResponse) {
        // Update existing record (only Likert fields)
        const { error: updateError } = await supabase
          .schema('maity')
          .from('form_responses')
          .update({
            q5: likertData.q5.toString(),
            q6: likertData.q6.toString(),
            q7: likertData.q7.toString(),
            q8: likertData.q8.toString(),
            q9: likertData.q9.toString(),
            q10: likertData.q10.toString(),
            q11: likertData.q11.toString(),
            q12: likertData.q12.toString(),
            q13: likertData.q13.toString(),
            q14: likertData.q14.toString(),
            q15: likertData.q15.toString(),
            q16: likertData.q16.toString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[RegistrationFormService] Error updating self-assessment:', updateError);
          throw updateError;
        }

        console.log('[RegistrationFormService] ✅ Self-assessment updated for user:', userId);
      } else {
        // Create new record with only Likert data (for admins who never completed full form)
        const { error: insertError } = await supabase
          .schema('maity')
          .from('form_responses')
          .insert({
            user_id: userId,
            q5: likertData.q5.toString(),
            q6: likertData.q6.toString(),
            q7: likertData.q7.toString(),
            q8: likertData.q8.toString(),
            q9: likertData.q9.toString(),
            q10: likertData.q10.toString(),
            q11: likertData.q11.toString(),
            q12: likertData.q12.toString(),
            q13: likertData.q13.toString(),
            q14: likertData.q14.toString(),
            q15: likertData.q15.toString(),
            q16: likertData.q16.toString(),
            submitted_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error('[RegistrationFormService] Error inserting self-assessment:', insertError);
          throw insertError;
        }

        // Mark registration as complete
        const { error: userUpdateError } = await supabase
          .schema('maity')
          .from('users')
          .update({
            registration_form_completed: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (userUpdateError) {
          console.error('[RegistrationFormService] Error updating user:', userUpdateError);
          throw userUpdateError;
        }

        console.log('[RegistrationFormService] ✅ Self-assessment created for user:', userId);
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('[RegistrationFormService] ❌ Error updating self-assessment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al actualizar autoevaluación. Por favor, intenta de nuevo.',
      };
    }
  }
}
