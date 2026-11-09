CREATE TYPE "UserStatus" AS ENUM ('ONLINE', 'OFFLINE', 'AWAY');
CREATE TYPE "ChatType" AS ENUM ('DIRECT', 'GROUP', 'CHANNEL');
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'VOICE', 'IMAGE', 'VIDEO', 'FILE', 'POLL');
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "User" (
  "id" VARCHAR(36) NOT NULL, "phoneNumber" TEXT, "email" TEXT, "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "avatarUrl" TEXT, "bio" TEXT, "publicKey" TEXT NOT NULL,
  "passwordHash" TEXT, "status" "UserStatus" NOT NULL DEFAULT 'OFFLINE',
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_username_idx" ON "User"("username");
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");

CREATE TABLE "RefreshToken" (
  "id" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL, "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

CREATE TABLE "DeviceKeyBundle" (
  "id" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL, "deviceId" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL, "signedPreKey" JSONB NOT NULL, "oneTimePreKeys" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceKeyBundle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceKeyBundle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceKeyBundle_userId_deviceId_key" ON "DeviceKeyBundle"("userId", "deviceId");
CREATE INDEX "DeviceKeyBundle_userId_idx" ON "DeviceKeyBundle"("userId");

CREATE TABLE "Chat" (
  "id" VARCHAR(36) NOT NULL, "type" "ChatType" NOT NULL DEFAULT 'DIRECT', "title" TEXT,
  "avatarUrl" TEXT, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Chat_type_idx" ON "Chat"("type");

CREATE TABLE "ChatMember" (
  "id" VARCHAR(36) NOT NULL, "chatId" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'MEMBER', "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReadMessageId" TEXT,
  CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatMember_chatId_userId_key" ON "ChatMember"("chatId", "userId");
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");

CREATE TABLE "Message" (
  "id" VARCHAR(36) NOT NULL, "chatId" VARCHAR(36) NOT NULL, "senderId" VARCHAR(36) NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'TEXT', "content" TEXT, "mediaUrl" TEXT,
  "mediaMetadata" JSONB, "status" "MessageStatus" NOT NULL DEFAULT 'SENT', "replyToId" VARCHAR(36),
  "isPinned" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

CREATE TABLE "Reaction" (
  "id" VARCHAR(36) NOT NULL, "messageId" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL,
  "emoji" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Reaction_messageId_userId_emoji_key" ON "Reaction"("messageId", "userId", "emoji");

CREATE TABLE "Story" (
  "id" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL, "mediaUrl" TEXT NOT NULL,
  "caption" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Story_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Story_expiresAt_idx" ON "Story"("expiresAt");

CREATE TABLE "StoryView" (
  "id" VARCHAR(36) NOT NULL, "storyId" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StoryView_storyId_userId_key" ON "StoryView"("storyId", "userId");

CREATE TABLE "Channel" (
  "id" VARCHAR(36) NOT NULL, "chatId" VARCHAR(36) NOT NULL, "slug" TEXT NOT NULL,
  "public" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Channel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Channel_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Channel_chatId_key" ON "Channel"("chatId");
CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");

CREATE TABLE "Post" (
  "id" VARCHAR(36) NOT NULL, "authorId" VARCHAR(36) NOT NULL, "content" TEXT NOT NULL,
  "mediaUrls" TEXT[] NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Post_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PostLike" (
  "id" VARCHAR(36) NOT NULL, "postId" VARCHAR(36) NOT NULL, "userId" VARCHAR(36) NOT NULL,
  CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PostLike_postId_userId_key" ON "PostLike"("postId", "userId");

CREATE TABLE "Poll" (
  "id" VARCHAR(36) NOT NULL, "postId" VARCHAR(36) NOT NULL, "question" TEXT NOT NULL,
  CONSTRAINT "Poll_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Poll_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Poll_postId_key" ON "Poll"("postId");
CREATE TABLE "PollOption" (
  "id" VARCHAR(36) NOT NULL, "pollId" VARCHAR(36) NOT NULL, "text" TEXT NOT NULL,
  CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PollVote" (
  "id" VARCHAR(36) NOT NULL, "pollId" VARCHAR(36) NOT NULL, "optionId" VARCHAR(36) NOT NULL,
  "userId" VARCHAR(36) NOT NULL,
  CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PollVote_pollId_userId_key" ON "PollVote"("pollId", "userId");
