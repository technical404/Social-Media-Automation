export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_provider_secrets: {
        Row: {
          api_key: string
          provider_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          provider_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          provider_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_secrets_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          api_key_hint: string | null
          base_url: string
          context_window: number | null
          created_at: string
          enabled: boolean
          has_api_key: boolean
          id: string
          image_input: boolean
          is_default_text: boolean
          last_success_at: string | null
          last_test_at: string | null
          last_test_message: string | null
          last_test_ms: number | null
          last_test_ok: boolean | null
          max_output: number | null
          max_retries: number
          model_id: string
          name: string
          protocol: string
          provider_type: string
          temperature: number | null
          thinking_effort: string
          timeout_ms: number
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_hint?: string | null
          base_url: string
          context_window?: number | null
          created_at?: string
          enabled?: boolean
          has_api_key?: boolean
          id?: string
          image_input?: boolean
          is_default_text?: boolean
          last_success_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ms?: number | null
          last_test_ok?: boolean | null
          max_output?: number | null
          max_retries?: number
          model_id: string
          name: string
          protocol: string
          provider_type?: string
          temperature?: number | null
          thinking_effort?: string
          timeout_ms?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          api_key_hint?: string | null
          base_url?: string
          context_window?: number | null
          created_at?: string
          enabled?: boolean
          has_api_key?: boolean
          id?: string
          image_input?: boolean
          is_default_text?: boolean
          last_success_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ms?: number | null
          last_test_ok?: boolean | null
          max_output?: number | null
          max_retries?: number
          model_id?: string
          name?: string
          protocol?: string
          provider_type?: string
          temperature?: number | null
          thinking_effort?: string
          timeout_ms?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          from_status: string | null
          id: string
          post_id: string | null
          to_status: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          from_status?: string | null
          id?: string
          post_id?: string | null
          to_status?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          from_status?: string | null
          id?: string
          post_id?: string | null
          to_status?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          calendar_id: string
          category: string | null
          created_at: string
          description: string | null
          event_date: string
          event_time: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          event_date: string
          event_time?: string
          id?: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          calendar_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          event_date?: string
          event_time?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "event_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      event_calendars: {
        Row: {
          created_at: string
          default_time: string
          end_date: string | null
          id: string
          industry: string | null
          name: string
          prompt: string | null
          scope: string
          start_date: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_time?: string
          end_date?: string | null
          id?: string
          industry?: string | null
          name: string
          prompt?: string | null
          scope?: string
          start_date?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          default_time?: string
          end_date?: string | null
          id?: string
          industry?: string | null
          name?: string
          prompt?: string | null
          scope?: string
          start_date?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_versions: {
        Row: {
          content: Json
          created_at: string
          id: string
          post_id: string
          user_id: string
          version: number
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          post_id: string
          user_id: string
          version: number
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_versions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          alt_text: string | null
          approved_at: string | null
          approved_version: number | null
          brand: string | null
          calendar_event_id: string | null
          caption: string
          created_at: string
          cta: string | null
          hashtags: string[]
          hooks: Json
          id: string
          image_prompt: string | null
          platform: string
          publish_result: Json | null
          published_at: string | null
          scheduled_at: string | null
          status: string
          timezone: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          alt_text?: string | null
          approved_at?: string | null
          approved_version?: number | null
          brand?: string | null
          calendar_event_id?: string | null
          caption?: string
          created_at?: string
          cta?: string | null
          hashtags?: string[]
          hooks?: Json
          id?: string
          image_prompt?: string | null
          platform: string
          publish_result?: Json | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Update: {
          alt_text?: string | null
          approved_at?: string | null
          approved_version?: number | null
          brand?: string | null
          calendar_event_id?: string | null
          caption?: string
          created_at?: string
          cta?: string | null
          hashtags?: string[]
          hooks?: Json
          id?: string
          image_prompt?: string | null
          platform?: string
          publish_result?: Json | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "posts_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      publish_due_posts: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
