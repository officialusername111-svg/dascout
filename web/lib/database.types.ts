// Generated from the DaScout Supabase project (kogpuuidawbmttyswvsx).
// Regenerate after any schema change:  supabase gen types typescript --linked > supabase/types/database.types.ts
// Do not edit by hand. Keep web/lib/database.types.ts in step with this file.

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
          name: string
          slug: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
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
          id: string
          is_trending: boolean
          lot_area_sqm: number | null
          price_php: number
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
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php: number
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
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php?: number
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
        }
        Relationships: [
          {
            foreignKeyName: "property_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          name: string
          province: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          initial?: string | null
          name: string
          province: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          initial?: string | null
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
      // ---------------------------------------------------------------------
      // HAND-ADDED, run-p6-admin-invites. The five functions below come from
      // `20260802021757_admin_invites_and_super_admin_split.sql`, which is
      // WRITTEN BUT NOT YET APPLIED, so `supabase gen types` cannot see them
      // and the generator would delete them if run before the apply. They are
      // transcribed from the migration's own signatures so `tsc` and `vitest`
      // work pre-apply. Same precedent as run-p5b-double-optin.
      //
      // CONFIRM BY REGENERATING once the migration has been applied, and
      // delete this comment when the regenerated file agrees. Two known places
      // it will differ: `full_name` below is widened to `string | null`
      // because `profiles.full_name` is nullable and the app must handle that
      // (the generator emits RETURNS TABLE columns as non-null); and
      // regeneration will also add the `admin_invites` table, which is left
      // out here on purpose because nothing in the app selects it this round.
      // ---------------------------------------------------------------------
      create_admin_invite: {
        Args: { invite_email: string }
        Returns: {
          invite_id: string
          invite_token: string
          invite_expires_at: string
        }[]
      }
      is_staff: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      list_admin_accounts: {
        Args: never
        Returns: {
          profile_id: string
          email: string
          full_name: string | null
          role: Database["public"]["Enums"]["user_role"]
          created_at: string
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
