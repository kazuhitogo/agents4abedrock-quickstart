import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';


export class Agents4ABedrockQuickstartStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // agents for bedrock の schema やデータを配置するバケット
    const bedrockBucket = new s3.Bucket(this, 'BedrockBucket',{
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    // schema を s3 に配置
    new cdk.aws_s3_deployment.BucketDeployment(this, 'asset', {
      sources: [cdk.aws_s3_deployment.Source.asset('./assets')],
      destinationBucket: bedrockBucket
    })

    // Agents for Bedrock がコールする Lambda に設定するロール
    const lambdaPolicy = new iam.ManagedPolicy(this, 'LambdaPolicy', {
      // managedPolicyName: 'lambda_basic_policy',
      description: 'Lambda basic execution policy',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['logs:*'],
          resources: ['arn:aws:logs:*:*:*'],
        }),
      ],
    });
    const lambdaRole = new iam.Role(this, 'LambdaRole',{
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        lambdaPolicy
      ]
    })

    // Agents for Bedrock が使用するロール周りの設定
    const modelPolicy = new iam.ManagedPolicy(this,'ModelPolicy',{
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeModel'],
          resources: [
            "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-v1",
            "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-v2",
            "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-instant-v1"
          ]
        })
      ]
    })

    const knowledgeBasePolicy = new iam.ManagedPolicy(this,'KnowledgeBasePolicy',{
      statements:[
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:QueyKnowledgeBase"],
          resources: [`arn:aws:bedrock:*:${accountId}:knowledge-base/*`]
        })
      ]
    })

    const agentPrincipal = new iam.ServicePrincipal(
      'bedrock.amazonaws.com'
      ).withConditions({
        StringEquals: {
          'aws:SourceAccount': accountId,
        },
        StringLike: {
          'aws:SourceArn': `arn:aws:bedrock:${region}:${accountId}:agent/*`
        },
      });

    const agentRole = new iam.Role(this, 'AgentRole',{
      assumedBy: agentPrincipal,
      roleName: 'AmazonBedrockExecutionRoleForAgents_cdk',
      managedPolicies: [
        knowledgeBasePolicy,
        modelPolicy,
      ],
      
    });
    
    bedrockBucket.grantRead(agentRole)

    const recommendFunction = new PythonFunction(this, 'recommendFunction',{
      runtime: lambda.Runtime.PYTHON_3_11,
      entry: 'lambda/recommend/',
      index: 'recommend.py',
      handler: 'lambda_handler',
      timeout: cdk.Duration.seconds(300)
    })

    recommendFunction.addPermission('agents-for-bedrock',{
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${region}:${accountId}:agent/*`
    })

    recommendFunction.grantInvoke(agentRole)

    const bucketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
				"s3:GetBucket*",
				"s3:GetObject*",
				"s3:List*",
      ],
			resources: [
				`arn:aws:s3:::${bedrockBucket.bucketName}`,
				`arn:aws:s3:::${bedrockBucket.bucketName}/*`
			],
      principals:[agentRole]
    })
    bedrockBucket.addToResourcePolicy(bucketPolicy);


    new cdk.CfnOutput(this, "SchemaUri", { value: `s3://${bedrockBucket.bucketName}/recommend.yaml`});
    new cdk.CfnOutput(this, "LambdaFunctionName", { value: recommendFunction.functionName});

  }
}
