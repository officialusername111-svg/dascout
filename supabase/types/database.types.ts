// Generated from the DaScout Supabase project (kogpuuidawbmttyswvsx).
// Regenerate after any schema change:  supabase gen types typescript --linked > supabase/types/database.types.ts
// Do not edit by hand. Keep web/lib/database.types.ts in step with this file.
//
// Regenerated 2026-08-02 against the live database, after run-p6 (admin invites and the
// admin/staff privilege split) and run-p7 (property number and the role-change audit trail)
// were both applied. Everything that used to be hand-transcribed here and in
// web/lib/database.types.ts is now generated, and was checked against what was transcribed.
// The two files are byte-identical.
//
// UPDATED 2026-08-03 for listing encoding v2, apply 1: the `property_types` table,
// `listings.property_type_id` / `frontage`, `property_requests.wanted_property_type_id`,
// `towns.is_active`, `features.is_active` / `sort_order`, and the `legacy_category_of`
// function. Applied as targeted edits against generator output rather than a wholesale
// overwrite, so the hand-correction below survives.
//
// KNOWN GAP, pre-dating this change and left alone: `list_admin_candidates`,
// `approve_admin_invite` and `decline_admin_invite` exist in the database but are absent
// from the Functions block here — the app declares their shapes locally in
// web/lib/admin/queries.ts. A future full regeneration will pull them in and must
// re-apply the correction below at the same time.
//
// ONE DELIBERATE DEPARTURE FROM THE GENERATOR, kept rather than lost in the regeneration:
// `list_admin_accounts.full_name` is `string | null` below, not the `string` the generator
// emits. The generator marks every RETURNS TABLE column non-null because a function
// signature carries no nullability. `profiles.full_name` is genuinely nullable, so the
// generated type would promise the app a null cannot arrive when it can. The correction is
// marked at its own site — re-apply it after any future regeneration.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          granted_role: Database["public"]["Enums"]["user_role"]
          id: string
          invited_by: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          granted_role?: Database["public"]["Enums"]["user_role"]
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          granted_role?: Database["public"]["Enums"]["user_role"]
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invites_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_role_changes: {
        Row: {
          actor_id: string | null
          changed_at: string
          from_role: Database["public"]["Enums"]["user_role"]
          id: string
          target_id: string
          to_role: Database["public"]["Enums"]["user_role"]
          via: string
        }
        Insert: {
          actor_id?: string | null
          changed_at?: string
          from_role: Database["public"]["Enums"]["user_role"]
          id?: string
          target_id: string
          to_role: Database["public"]["Enums"]["user_role"]
          via: string
        }
        Update: {
          actor_id?: string | null
          changed_at?: string
          from_role?: Database["public"]["Enums"]["user_role"]
          id?: string
          target_id?: string
          to_role?: Database["public"]["Enums"]["user_role"]
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_changes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_role_changes_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          listing_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      listing_features: {
        Row: {
          feature_id: string
          listing_id: string
        }
        Insert: {
          feature_id: string
          listing_id: string
        }
        Update: {
          feature_id?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_features_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_photos: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          is_primary: boolean
          listing_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          listing_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          listing_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_views: {
        Row: {
          id: string
          listing_id: string
          profile_id: string | null
          session_hash: string
          viewed_at: string
          viewed_on: string
        }
        Insert: {
          id?: string
          listing_id: string
          profile_id?: string | null
          session_hash: string
          viewed_at?: string
          viewed_on?: string
        }
        Update: {
          id?: string
          listing_id?: string
          profile_id?: string | null
          session_hash?: string
          viewed_at?: string
          viewed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_views_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_views_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          area_detail: string | null
          bathrooms: number | null
          bedrooms: number | null
          broker_id: string | null
          category: Database["public"]["Enums"]["listing_category"]
          created_at: string
          created_by: string | null
          description: string | null
          floor_area_sqm: number | null
          frontage: string | null
          id: string
          is_trending: boolean
          lot_area_sqm: number | null
          price_php: number
          property_no: string | null
          property_type_id: string | null
          published_at: string | null
          search_vector: unknown
          slug: string
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          town_id: string
          updated_at: string
        }
        Insert: {
          area_detail?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          category: Database["public"]["Enums"]["listing_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          floor_area_sqm?: number | null
          frontage?: string | null
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php: number
          property_no?: string | null
          property_type_id?: string | null
          published_at?: string | null
          search_vector?: unknown
          slug: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          town_id: string
          updated_at?: string
        }
        Update: {
          area_detail?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          category?: Database["public"]["Enums"]["listing_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          floor_area_sqm?: number | null
          frontage?: string | null
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php?: number
          property_no?: string | null
          property_type_id?: string | null
          published_at?: string | null
          search_vector?: unknown
          slug?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_property_type_id_fkey"
            columns: ["property_type_id"]
            isOneToOne: false
            referencedRelation: "property_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "towns"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          listing_id: string
          new_price: number
          old_price: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          listing_id: string
          new_price: number
          old_price?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          listing_id?: string
          new_price?: number
          old_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      property_requests: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          category: Database["public"]["Enums"]["listing_category"] | null
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          is_handled: boolean
          notes: string | null
          preferred_town: string | null
          profile_id: string | null
          wanted_property_type_id: string | null
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          is_handled?: boolean
          notes?: string | null
          preferred_town?: string | null
          profile_id?: string | null
          wanted_property_type_id?: string | null
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          is_handled?: boolean
          notes?: string | null
          preferred_town?: string | null
          profile_id?: string | null
          wanted_property_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_requests_wanted_property_type_id_fkey"
            columns: ["wanted_property_type_id"]
            isOneToOne: false
            referencedRelation: "property_types"
            referencedColumns: ["id"]
          },
        ]
      }
      property_types: {
        Row: {
          created_at: string
          group_key: string | null
          icon: string
          id: string
          is_active: boolean
          legacy_category:
            | Database["public"]["Enums"]["listing_category"]
            | null
          name: string
          plural_name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_key?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          legacy_category?:
            | Database["public"]["Enums"]["listing_category"]
            | null
          name: string
          plural_name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_key?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          legacy_category?:
            | Database["public"]["Enums"]["listing_category"]
            | null
          name?: string
          plural_name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      request_match_alerts: {
        Row: {
          created_at: string
          listing_id: string
          request_id: string
          sent_at: string | null
        }
        Insert: {
          created_at?: string
          listing_id: string
          request_id: string
          sent_at?: string | null
        }
        Update: {
          created_at?: string
          listing_id?: string
          request_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_match_alerts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_match_alerts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "property_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      towns: {
        Row: {
          created_at: string
          id: string
          initial: string | null
          is_active: boolean
          name: string
          province: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          initial?: string | null
          is_active?: boolean
          name: string
          province: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          initial?: string | null
          is_active?: boolean
          name?: string
          province?: string
          slug?: string
        }
        Relationships: []
      }
      verification_events: {
        Row: {
          id: string
          kind: Database["public"]["Enums"]["verification_kind"]
          listing_id: string
          notes: string | null
          occurred_at: string
          performed_by: string | null
        }
        Insert: {
          id?: string
          kind: Database["public"]["Enums"]["verification_kind"]
          listing_id: string
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
        }
        Update: {
          id?: string
          kind?: Database["public"]["Enums"]["verification_kind"]
          listing_id?: string
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_events_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_my_listing_views: { Args: never; Returns: number }
      confirm_property_request: { Args: { req_id: string }; Returns: undefined }
      create_admin_invite: {
        Args: { invite_email: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      is_staff: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      legacy_category_of: {
        Args: { p_type_id: string }
        Returns: Database["public"]["Enums"]["listing_category"]
      }
      list_admin_accounts: {
        Args: never
        Returns: {
          created_at: string
          email: string
          // HAND-CORRECTED, and the ONLY departure from `supabase gen types` in this
          // file. The generator emits every RETURNS TABLE column as non-null, because a
          // function signature carries no nullability of its own. `profiles.full_name`
          // is nullable and the app must handle a null here, so the generated `string`
          // would be a promise the database does not make. Re-apply this after any
          // future regeneration — see the note at the top of the file.
          full_name: string | null
          profile_id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      redeem_admin_invite: { Args: { raw_token: string }; Returns: string }
      reorder_listing_photos: {
        Args: { p_listing_id: string; p_photo_ids: string[] }
        Returns: number
      }
      revoke_staff_admin: { Args: { target_id: string }; Returns: string }
      top_listings: {
        Args: { period?: string; row_limit?: number }
        Returns: {
          listing_id: string
          views: number
        }[]
      }
      unsubscribe_property_request: {
        Args: { req_id: string }
        Returns: undefined
      }
    }
    Enums: {
      listing_category:
        | "residential_lot"
        | "farm_land"
        | "commercial_lot"
        | "residential_building"
        | "commercial_building"
      listing_status: "draft" | "verifying" | "live" | "sold" | "withdrawn"
      user_role: "buyer" | "broker" | "staff" | "admin"
      verification_kind: "title_check" | "ground_validation" | "published"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      listing_category: [
        "residential_lot",
        "farm_land",
        "commercial_lot",
        "residential_building",
        "commercial_building",
      ],
      listing_status: ["draft", "verifying", "live", "sold", "withdrawn"],
      user_role: ["buyer", "broker", "staff", "admin"],
      verification_kind: ["title_check", "ground_validation", "published"],
    },
  },
} as const
